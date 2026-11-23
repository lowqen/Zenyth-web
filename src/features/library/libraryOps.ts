import { YxdbCancelled } from "../../core/database/yxdbfile";
import type { JobProgress, MergeSummary } from "../../core/database/yxdbmerge";
import type { SplitBase, SplitCounts, SplitPlan } from "../../core/database/yxdbsplit";
import {
  fingerprintOf,
  journalOf,
  type LibraryCover,
  type LibraryMetaRow,
} from "../../data/library";
import { t } from "../../i18n/i18n";
import { browserSource } from "./browserSource";
import { createEntry, getEntry, recordSaved, trashEntry, updateEntry } from "./library";
import type { LibraryTask } from "./libraryWorker";
import type { LibraryJob, LibraryJobResults, MergeJobOptions, MergeJobSource } from "./protocol";

/**
 * 병합 · 분리의 메인 스레드 쪽(라이브러리 계획 §7 · L3) — 입력 파일을 모으고, 워커가 다 쓰고 대조한 `Blob` 만
 * 소스에 놓는다. **원본은 건드리지 않는 것이 기본**이고, 워커가 도중에 끊기면(취소 · 강제 종료) 소스에는 아무것도
 * 남지 않는다 — 놓는 일은 끝에 한 번(`writeAtomic`).
 *
 * 워커는 주입한다(`JobRunner`) — 시험은 같은 몸통(`runJob`)을 그 자리에서 돌린다.
 */

export type JobRunner = <J extends LibraryJob>(
  job: J,
  onProgress?: (p: JobProgress) => void,
) => LibraryTask<LibraryJobResults[J["kind"]]>;

/** 저널의 머리 크기 — 이보다 크면 접히지 않은 변경이 있다(`dbStore.JOURNAL_HEADER` 와 같은 값). */
export interface OpsEnv {
  run: JobRunner;
  journalHeader: number;
  onProgress?: (p: JobProgress) => void;
}

/** 쉬는 파일(저널이 접힌 한 벌)을 연다. 파일이 없으면(저장 전 새 DB) null, 접히지 않은 저널이면 까닭. */
export async function restingFile(
  e: LibraryMetaRow,
  journalHeader: number,
): Promise<Blob | null | { error: string }> {
  const [base, journal] = await Promise.all([
    browserSource.open(e.file),
    browserSource.open(journalOf(e.file)),
  ]);
  if (!base) return null;
  if (journal && journal.size > journalHeader)
    return {
      error: t("«{name}» 의 저널에 접히지 않은 변경이 있습니다. DB 를 붙인 뒤 저장하세요", {
        name: e.title,
      }),
    };
  return base;
}

/** 작업 하나를 돌린다 — 취소는 `signal.cancel` 로 지금 맡긴 작업까지 닿는다. */
class OpSignal {
  cancelled = false;
  private task: LibraryTask<unknown> | null = null;
  async run<J extends LibraryJob>(env: OpsEnv, job: J): Promise<LibraryJobResults[J["kind"]]> {
    if (this.cancelled) throw new YxdbCancelled();
    const task = env.run(job, env.onProgress);
    this.task = task;
    try {
      return await task.promise;
    } finally {
      this.task = null;
    }
  }
  cancel(): void {
    this.cancelled = true;
    this.task?.cancel();
  }
}

export interface OpHandle<T> {
  readonly promise: Promise<T>;
  cancel(): void;
}

function op<T>(body: (sig: OpSignal) => Promise<T>): OpHandle<T> {
  const sig = new OpSignal();
  return { promise: body(sig), cancel: () => sig.cancel() };
}

async function inputsOf(
  ids: readonly string[],
  journalHeader: number,
): Promise<{ entries: LibraryMetaRow[]; files: Blob[] }> {
  const entries: LibraryMetaRow[] = [];
  const files: Blob[] = [];
  for (const id of ids) {
    const e = await getEntry(id);
    if (!e) throw new Error(t("라이브러리에 없는 DB 입니다"));
    const f = await restingFile(e, journalHeader);
    if (f && "error" in f) throw new Error(f.error);
    if (!f) throw new Error(t("«{name}» 은 아직 저장된 파일이 없습니다", { name: e.title }));
    entries.push(e);
    files.push(f);
  }
  return { entries, files };
}

/** 새 항목으로 놓는다 — 다 쓴 파일 하나를 한 트랜잭션에. */
async function placeNew(title: string, cover: LibraryCover, file: Blob): Promise<LibraryMetaRow> {
  const e = await createEntry(title, { select: false });
  if (!e) throw new Error(t("이 브라우저는 저장소(IndexedDB)를 쓸 수 없습니다"));
  const savedAt = Date.now();
  await browserSource.writeAtomic([{ name: e.file, data: file }], savedAt);
  const fingerprint = await fingerprintOf(file, savedAt);
  await updateEntry(e.id, { cover, fingerprint, updatedAt: savedAt });
  return { ...e, cover, fingerprint, updatedAt: savedAt };
}

// ── 병합 ───────────────────────────────────────────────────────────

export interface MergePrepared {
  ids: string[];
  options: MergeJobOptions;
  summary: MergeSummary;
  sources: MergeJobSource[];
  /** 미리 볼 때의 정체 — 쓰기 전에 바뀌었으면 다시 미리 본다. */
  sizes: number[];
}

/** ③ 미리 보기 — 순서(맨 위가 기준) · 정책으로 센다. */
export function previewMerge(
  ids: readonly string[],
  options: MergeJobOptions,
  env: OpsEnv,
): OpHandle<MergePrepared> {
  return op(async (sig) => {
    const { files } = await inputsOf(ids, env.journalHeader);
    const r = await sig.run(env, { kind: "mergeCount", files, options });
    return {
      ids: [...ids],
      options,
      summary: r.summary,
      sources: r.sources,
      sizes: files.map((f) => f.size),
    };
  });
}

export interface MergeCommit {
  title: string;
  cover: LibraryCover;
  /** 원본을 휴지통으로(기본 꺼짐). 붙어 있는 DB 는 늘 남긴다. */
  trashOriginals: boolean;
  /** 지금 붙은 항목 — 휴지통으로 보내지 않는다. */
  attachedId: string | null;
}

/** [합치기] — 쓰고 대조한 뒤 새 항목으로. 원본은 고르면 휴지통으로(되돌릴 수 있다). */
export function commitMerge(
  prep: MergePrepared,
  commit: MergeCommit,
  env: OpsEnv,
): OpHandle<{ entry: LibraryMetaRow; trashed: string[] }> {
  return op(async (sig) => {
    const { files } = await inputsOf(prep.ids, env.journalHeader);
    if (files.some((f, i) => f.size !== prep.sizes[i]))
      throw new Error(t("미리 본 뒤에 DB 가 바뀌었습니다. 다시 미리 보세요"));
    const r = await sig.run(env, {
      kind: "mergeWrite",
      sources: prep.sources,
      options: prep.options,
      count: prep.summary.records,
    });
    if (sig.cancelled) throw new YxdbCancelled();
    const entry = await placeNew(commit.title, commit.cover, r.file);
    const trashed: string[] = [];
    if (commit.trashOriginals)
      for (const id of prep.ids) {
        if (id === commit.attachedId) continue;
        await trashEntry(id);
        trashed.push(id);
      }
    return { entry, trashed };
  });
}

// ── 분리 ───────────────────────────────────────────────────────────

/** ① 기준 — 모든 기준의 개수를 한 번에. 색인이 막히면(메모리) 주형만 빠진다. */
export function previewSplit(
  id: string,
  base: SplitBase | null,
  env: OpsEnv,
): OpHandle<{ counts: SplitCounts; size: number }> {
  return op(async (sig) => {
    const { files } = await inputsOf([id], env.journalHeader);
    const counts = await sig.run(env, {
      kind: "splitCount",
      file: files[0]!,
      base,
      withOpenings: true,
    });
    return { counts, size: files[0]!.size };
  });
}

export interface SplitResultMeta {
  title: string;
  cover: LibraryCover;
}

export interface SplitCommit {
  plan: SplitPlan;
  /** 결과마다(나머지 빼고) 이름 · 커버. */
  outputs: readonly SplitResultMeta[];
  /** 옮기기 — 원본을 나머지로 바꾼다(원본은 휴지통에 백업). `plan.rest` 가 있어야 한다. */
  move: boolean;
  /** 메타데이터 레코드가 있었다(`SplitCounts.meta`). */
  meta: boolean;
  /** 미리 볼 때의 파일 크기 — 바뀌었으면 다시. */
  size: number;
}

/** [나누기] — 결과마다 새 항목. 옮기기면 원본의 사본을 휴지통에 두고 원본 파일을 나머지로 바꾼다. */
export function commitSplit(
  id: string,
  commit: SplitCommit,
  env: OpsEnv,
): OpHandle<{ entries: LibraryMetaRow[]; backup: string | null }> {
  return op(async (sig) => {
    if (commit.move !== Boolean(commit.plan.rest))
      throw new Error("split: 옮기기에는 나머지가 있어야 한다");
    if (commit.outputs.length !== commit.plan.outputs.length)
      throw new Error("split: 결과 이름 수");
    const { entries: src, files } = await inputsOf([id], env.journalHeader);
    const original = files[0]!;
    if (original.size !== commit.size)
      throw new Error(t("미리 본 뒤에 DB 가 바뀌었습니다. 다시 미리 보세요"));
    const r = await sig.run(env, {
      kind: "splitWrite",
      file: original,
      plan: commit.plan,
      meta: commit.meta,
    });
    if (sig.cancelled) throw new YxdbCancelled();
    const entries: LibraryMetaRow[] = [];
    for (const [i, m] of commit.outputs.entries())
      entries.push(await placeNew(m.title, m.cover, r.files[i]!));
    let backup: string | null = null;
    if (commit.move) {
      const e = src[0]!;
      // 원본 사본 → 휴지통의 새 항목(되돌릴 수 있다), 그다음 원본 파일을 나머지로
      const b = await placeNew(t("{name} (나누기 전)", { name: e.title }), e.cover, original);
      await trashEntry(b.id);
      backup = b.id;
      const rest = r.files[commit.plan.outputs.length]!;
      const savedAt = Date.now();
      await browserSource.writeAtomic(
        [
          { name: e.file, data: rest },
          { name: journalOf(e.file), data: null },
        ],
        savedAt,
      );
      // 본 파일이 바뀌었다 — 정체를 갈고 통계를 버린다(다시 센다)
      await recordSaved(e.id, savedAt, await fingerprintOf(rest, savedAt));
    }
    return { entries, backup };
  });
}
