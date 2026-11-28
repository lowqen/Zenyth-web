import { create } from "zustand";
import { YxdbCancelled } from "../../core/database/yxdbfile";
import type { DbStats, ScanPhase, ScanResult } from "../../core/database/yxdbindex";
import { statsCurrent } from "../../core/database/yxdbstats";
import { decodeKey, hexToKey } from "../../core/database/yxdbkey";
import { representative } from "../../core/opening/opening26";
import type { Move } from "../../core/model/move";
import type { PlayRule } from "../../core/model/rules";
import { db } from "../../data/db";
import {
  BROWSER_SOURCE_ID,
  fingerprintOf,
  journalOf,
  sameFingerprint,
  type LibraryCover,
  type LibraryMetaRow,
  type SourceKind,
} from "../../data/library";
import { t } from "../../i18n/i18n";
import { useGameStore } from "../board/gameStore";
import { useBoardStore } from "../board/boardStore";
import { keepBoardBefore } from "../board/linkBackup";
import { JOURNAL_HEADER, useDbStore } from "../database/dbStore";
import { saveManifest, syncFolder } from "./folderSync";
import {
  createEntry,
  freeFileName,
  discardEntry,
  getEntry,
  listEntries,
  listTrashed,
  purgeEntry,
  readActiveId,
  restoreEntry,
  trashEntry,
  updateEntry,
} from "./library";
import type { SplitBase, SplitCounts } from "../../core/database/yxdbsplit";
import {
  commitMerge,
  commitSplit,
  previewMerge,
  previewSplit,
  type MergePrepared,
  type OpHandle,
  type OpsEnv,
  type SplitCommit,
} from "./libraryOps";
import { runLibraryJob, scanLibraryFile, type LibraryScan } from "./libraryWorker";
import type { MergeJobOptions } from "./protocol";
import { isFolderSource, type SourceAccess } from "./source";
import { useStartMode, type StartMode } from "./startMode";
import {
  addFolder,
  canOpenFolders,
  folderSources,
  loadSources,
  removeFolder,
  sourceOf,
} from "./sources";

/**
 * 라이브러리 화면의 상태(라이브러리 계획 §6 · L2) — 항목 목록 · 파일 크기 · 통계 세기 · 휴지통, 그리고 «열기» 동선.
 *
 * 통계는 워커(`scanLibraryFile`)가 하나씩 센다. 정체(`fingerprint`)가 같으면 다시 세지 않고(§3), 세는 동안 파일이
 * 바뀌었으면(저장) 결과를 버리고 다음 차례에 다시 센다. 붙은 DB 는 **저장된 파일**을 센다 — 엔진 메모리의 저장 안 된
 * 변경은 다음 저장 뒤에 들어온다.
 */

export interface ScanState {
  id: string;
  phase: ScanPhase;
  fraction: number;
}

/** 색인을 건너뛴 까닭 — 상세가 한 줄로 말한다. */
export type ScanNote = "memory" | "alloc" | "unordered" | "error";

export type LibrarySort = "recent" | "name" | "size";

/** 병합 · 분리 작업(L3) — 한 번에 하나. 입력 항목은 이름 바꾸기 · 지우기만 잠긴다(«작업 중»). */
export interface LibraryJobState {
  kind: "merge" | "split";
  ids: string[];
  phase: string;
  fraction: number;
}

/** 소스 칩 하나 — 브라우저 소스와 폴더들. */
export interface SourceView {
  id: string;
  kind: SourceKind;
  /** 칩 글(폴더 이름). 브라우저 소스는 없다. */
  label?: string;
  /** 폴더에 닿을 수 있는가 — `prompt` 면 칩이 «다시 허용». */
  access: SourceAccess;
}

/** 작업의 끝 — 값, 까닭, 또는 취소(`error: null`). */
export type OpResult<T> = { ok: true; value: T } | { ok: false; error: string | null };

interface LibraryState {
  loaded: boolean;
  entries: LibraryMetaRow[];
  trashed: LibraryMetaRow[];
  /** 항목 id → 본 파일 + 저널 바이트(파일이 없으면 0). */
  sizes: Record<string, number>;
  scan: ScanState | null;
  /** 항목 id → 색인을 건너뛴 까닭(이번 세션). */
  notes: Record<string, ScanNote>;
  /** 마지막에 지운 항목(들) — 10초 되돌리기. */
  undo: { ids: string[]; title: string; at: number } | null;
  job: LibraryJobState | null;
  /** 여러 개 고르기 — 고른 순서(합치기의 기본 순서, 맨 앞이 기준). */
  selected: string[];
  /** 소스 칩들 — 맨 앞은 늘 브라우저 소스. */
  sources: SourceView[];
  /** 고른 칩 — 격자 · [가져오기] · [새 DB] 가 이 소스를 본다. */
  sourceId: string;
  /** 이 화면에서 폴더를 열 수 있는가(데스크톱 · 웹 Chromium). */
  canOpenFolders: boolean;

  load: () => Promise<void>;
  create: (title: string) => Promise<LibraryMetaRow | null>;
  /** 고른 칩의 소스로 가져온다(폴더면 파일을 복사해 둔다). 커버는 «자동». */
  importFile: (file: File) => Promise<string | null>;
  /**
   * 제목을 바꾼다 — `alsoFile` 이면 폴더 소스의 파일 이름도(저널 · 백업도 함께). 붙은 DB 면 저장 · 떼기 → 옮기기 →
   * 다시 붙이기. 다른 프로그램이 쥐어 옮기지 못하면 제목만 바꾸고 파일 이름은 다음에 다시 시도한다. 알림 글 또는 null.
   */
  rename: (id: string, title: string, alsoFile?: boolean) => Promise<string | null>;
  selectSource: (id: string) => void;
  /** [+ 폴더 열기] — 웹은 클릭 안에서 불러야 한다. 알림 글 또는 null. */
  addFolder: () => Promise<string | null>;
  /** «폴더 다시 허용» — 웹은 클릭 안에서. */
  grantFolder: (id: string) => Promise<string | null>;
  /** 폴더를 라이브러리에서 뺀다(파일 · 사이드카는 그대로). */
  removeFolder: (id: string) => Promise<string | null>;
  setCover: (id: string, cover: LibraryCover) => Promise<void>;
  trash: (id: string) => Promise<string | null>;
  /** 고른 것을 한꺼번에 휴지통으로 — 붙어 있거나 작업 중인 DB 는 건너뛴다. 건너뛴 까닭 또는 null. */
  trashMany: (ids: readonly string[]) => Promise<string | null>;
  toggleSelect: (id: string) => void;
  clearSelection: () => void;
  mergePreview: (
    ids: readonly string[],
    options: MergeJobOptions,
  ) => Promise<OpResult<MergePrepared>>;
  merge: (
    prep: MergePrepared,
    title: string,
    trashOriginals: boolean,
  ) => Promise<OpResult<LibraryMetaRow>>;
  splitPreview: (
    id: string,
    base: SplitBase | null,
  ) => Promise<OpResult<{ counts: SplitCounts; size: number }>>;
  split: (id: string, commit: SplitCommit) => Promise<OpResult<LibraryMetaRow[]>>;
  cancelJob: () => void;
  restore: (id: string) => Promise<void>;
  purge: (id: string) => Promise<void>;
  exportFile: (id: string) => Promise<{ file: Blob; name: string } | { error: string }>;
  /**
   * 이 DB 를 붙이고 국면을 연다 — `moves === null` 이면 판은 그대로(편집기로 갈 때), `"start"` 는 DB 의 기록이
   * 시작되는 국면(가장 큰 뿌리 — 통계가 없으면 판은 그대로). 판을 바꾸면 두던 판은 보관한다(`keepBoardBefore`).
   * 오류 글 또는 null.
   */
  open: (id: string, moves: readonly Move[] | null | "start") => Promise<string | null>;
  cancelScan: () => void;
  /** 세지 못한 항목을 다시 센다. */
  rescan: (id: string) => void;
}

let current: LibraryScan | null = null;
let pumping = false;
let jobHandle: OpHandle<unknown> | null = null;

const SOURCE_KEY = "rapfi.library.source";

function readSourceId(): string {
  try {
    return localStorage.getItem(SOURCE_KEY) ?? BROWSER_SOURCE_ID;
  } catch {
    return BROWSER_SOURCE_ID;
  }
}

function writeSourceId(id: string): void {
  try {
    localStorage.setItem(SOURCE_KEY, id);
  } catch {
    /* 이번 세션만 */
  }
}

/** 본 파일 + 저널 크기 — 읽지 않는다. 소스에 닿을 수 없으면 0(통계 세기도 건너뛴다). */
async function fileSize(e: LibraryMetaRow, access: Record<string, SourceAccess>): Promise<number> {
  const src = sourceOf(e.source);
  if (!src || (access[e.source] ?? "granted") !== "granted") return 0;
  try {
    const [base, journal] = await Promise.all([src.stat(e.file), src.stat(journalOf(e.file))]);
    return (base?.size ?? 0) + (base ? (journal?.size ?? 0) : 0);
  } catch {
    return 0;
  }
}

/** 이름 바꾸기 실패가 «다른 프로그램이 쥔 파일» 인가 — 셸은 `busy:` 로, 웹 폴더는 잠금 오류로 알린다. */
const isBusyError = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  const n = (e as { name?: string })?.name;
  return m.startsWith("busy:") || n === "NoModificationAllowedError" || n === "InvalidStateError";
};

/** 쓰기 전에 — 처음이면 영속 저장을 청하고(지워지지 않게), 남은 자리가 모자라면 까닭. */
async function roomFor(bytes: number): Promise<string | null> {
  const sm = typeof navigator !== "undefined" ? navigator.storage : undefined;
  if (!sm) return null;
  try {
    if (sm.persisted && !(await sm.persisted())) await sm.persist?.();
    const est = await sm.estimate?.();
    if (est?.quota !== undefined && est.usage !== undefined && est.quota - est.usage < bytes * 1.1)
      return t("이 브라우저의 저장 공간이 모자랍니다");
  } catch {
    /* 묻지 못하면 써 본다 */
  }
  return null;
}

/** DB 국면 키 → 판에 놓을 수(흑 · 백을 번갈아). 판 크기가 다르거나 패스 칸이 있으면 null. */
/**
 * DB 의 기록이 시작되는 국면 — 이 판 크기로 읽히는 가장 큰 뿌리의 시작점(가장 무거운 자식이 90% 이상인 동안
 * 내려간 곳, 색인 판 3), 없으면 그 뿌리. 통계(뿌리)가 없으면 null.
 */
export function startMovesOf(
  stats: DbStats | undefined,
  size: number,
  mode: StartMode = "branch",
): Move[] | null {
  if (mode === "empty") return [];
  for (const r of stats?.roots ?? []) {
    const m = movesOfKey(r.key, size);
    if (!m) continue;
    if (mode === "root") return m;
    return (r.start ? movesOfKey(r.start, size) : null) ?? m;
  }
  return null;
}

/**
 * DB 의 국면이 가장 많은 규칙(`stats.rules` 의 `renju-15` …)과 정사각 판 크기 — 통계가 없거나 아는 규칙이 아니면
 * null. «이 DB 열기»가 판의 규칙과 다르면 묻는다(L5-6 P3, 앱 `LibraryPositions.mainRuleOf`).
 */
export function mainRuleOf(stats: DbStats | undefined): { rule: PlayRule; size: number } | null {
  const top = Object.entries(stats?.rules ?? {}).sort((a, b) => b[1] - a[1])[0];
  const m = top && /^(freestyle|standard|renju)-(\d+)$/.exec(top[0]);
  return m ? { rule: m[1] as PlayRule, size: Number(m[2]) } : null;
}

export function movesOfKey(hex: string, size: number): Move[] | null {
  let k;
  try {
    k = decodeKey(hexToKey(hex));
  } catch {
    return null;
  }
  if (!k || k.pass || k.w !== size || k.h !== size) return null;
  const out: Move[] = [];
  for (let i = 0; i < k.black.length || i < k.white.length; i++) {
    if (i < k.black.length) out.push(k.black[i]!);
    if (i < k.white.length) out.push(k.white[i]!);
  }
  // 흑이 백보다 하나 많거나 같아야 둔 순서로 읽힌다.
  return k.black.length - k.white.length === 0 || k.black.length - k.white.length === 1
    ? out
    : null;
}

export const openingMoves = (index: number): Move[] => representative(index);

export const useLibraryStore = create<LibraryState>((set, get) => {
  const accessMap = () => Object.fromEntries(get().sources.map((s) => [s.id, s.access]));

  const refresh = async () => {
    const [entries, trashed] = await Promise.all([listEntries(), listTrashed()]);
    const sizes: Record<string, number> = {};
    const access = accessMap();
    await Promise.all(entries.map(async (e) => void (sizes[e.id] = await fileSize(e, access))));
    set({ entries, trashed, sizes, loaded: true });
  };

  /** 소스 줄을 읽고 폴더마다 닿을 수 있는지 잰다. 고른 칩이 사라졌으면 브라우저로. */
  const loadSourceViews = async () => {
    const rows = await loadSources();
    const views: SourceView[] = [{ id: BROWSER_SOURCE_ID, kind: "browser", access: "granted" }];
    for (const r of rows) {
      if (r.kind === "browser") continue;
      const src = folderSources().find((s) => s.id === r.id);
      views.push({
        id: r.id,
        kind: r.kind,
        label: r.label ?? r.id,
        access: src ? await src.access() : "missing",
      });
    }
    const sourceId = views.some((v) => v.id === get().sourceId)
      ? get().sourceId
      : BROWSER_SOURCE_ID;
    set({ sources: views, sourceId, canOpenFolders: canOpenFolders() });
  };

  /** 닿을 수 있는 폴더를 사이드카 · 파일과 맞추고, 미뤄 둔 파일 이름 바꾸기를 다시 해 본다. */
  const syncFolders = async (only?: string) => {
    for (const v of get().sources) {
      if (v.kind === "browser" || v.access !== "granted" || (only && v.id !== only)) continue;
      const src = sourceOf(v.id);
      if (!src) continue;
      try {
        const rows = await syncFolder(src);
        for (const r of rows)
          if (r.fileRenamePending && !r.trashedAt && !r.missingSince) await retryFileRename(r);
      } catch (e) {
        console.warn("[library] 폴더를 맞추지 못했다", e);
      }
    }
  };

  /** 미뤄 둔 파일 이름 바꾸기 — 붙어 있지 않을 때만, 조용히. */
  const retryFileRename = async (e: LibraryMetaRow) => {
    const dbs = useDbStore.getState();
    if (dbs.active?.id === e.id && dbs.status !== "off") return;
    const src = sourceOf(e.source);
    if (!src || !e.fileRenamePending) return;
    try {
      const want = await freeFileName(e.source, e.title, e.id);
      if (want !== e.file) await src.rename(e.file, want);
      await updateEntry(e.id, { file: want }, ["fileRenamePending"]);
    } catch {
      /* 아직 쥐고 있다 — 다음에 */
    }
  };

  /** 통계가 없는(또는 정체가 바뀐) 항목을 하나씩 센다. 이미 돌고 있으면 그 줄이 이어서 집는다. */
  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      for (;;) {
        if (get().job) break; // 병합 · 분리가 줄을 쓰는 동안은 쉰다 — 끝나면 다시 부른다
        const next = get().entries.find(
          (e) =>
            !statsCurrent(e.stats) && (get().sizes[e.id] ?? 0) > 0 && get().notes[e.id] !== "error",
        );
        if (!next) break;
        await scanOne(next);
      }
    } finally {
      pumping = false;
      set({ scan: null });
    }
  };

  const scanOne = async (e: LibraryMetaRow) => {
    const src = sourceOf(e.source);
    let file: Blob | null;
    try {
      file = (await src?.open(e.file)) ?? null;
    } catch {
      set((s) => ({ notes: { ...s.notes, [e.id]: "error" } }));
      return;
    }
    if (!src || !file) return;
    const mtime = (await src.stat(e.file))?.mtime ?? e.updatedAt;
    const before = await fingerprintOf(file, mtime);
    set({ scan: { id: e.id, phase: "stats", fraction: 0 } });
    let last = 0;
    const job = scanLibraryFile(file, {
      onProgress: (p) => {
        // 진행은 10Hz 로 묶어 온다 — 화면은 1% 넘게 움직였을 때만 다시 그린다.
        if (Math.abs(p.fraction - last) < 0.01 && p.phase === get().scan?.phase) return;
        last = p.fraction;
        set({ scan: { id: e.id, phase: p.phase, fraction: p.fraction } });
      },
    });
    current = job;
    let result: ScanResult;
    try {
      result = await job.promise;
    } catch (err) {
      if (!(err instanceof YxdbCancelled)) set((s) => ({ notes: { ...s.notes, [e.id]: "error" } }));
      return;
    } finally {
      current = null;
    }
    // 세는 동안 저장이 있었으면 버린다 — 다음 차례가 새 파일로 다시 센다.
    const now = await getEntry(e.id);
    const fp = now ? await src.fingerprint(now.file).catch(() => null) : null;
    if (!now || !fp) return;
    if (!sameFingerprint(before, fp)) return;
    if (now.fingerprint && !sameFingerprint(now.fingerprint, fp)) return;
    const skipped = result.indexSkipped ?? result.openingsSkipped;
    if (skipped) set((s) => ({ notes: { ...s.notes, [e.id]: skipped } }));
    const stats: DbStats = result.stats;
    await updateEntry(e.id, { stats, fingerprint: now.fingerprint ?? fp });
    set((s) => ({
      entries: s.entries.map((x) =>
        x.id === e.id ? { ...x, stats, fingerprint: x.fingerprint ?? fp } : x,
      ),
    }));
  };

  /**
   * 병합 · 분리 하나를 돌린다 — 세던 통계는 멈추고(줄을 비운다), 붙은 DB 가 끼면 먼저 저장 · 접는다(쉬는 파일 불변식).
   * 끝나면 목록을 다시 읽고 통계 세기를 잇는다.
   */
  const runOp = async <T>(
    kind: LibraryJobState["kind"],
    ids: readonly string[],
    make: (env: OpsEnv) => OpHandle<T>,
  ): Promise<OpResult<T>> => {
    if (get().job) return { ok: false, error: t("다른 작업이 진행 중입니다") };
    current?.cancel();
    set({ job: { kind, ids: [...ids], phase: "prepare", fraction: 0 } });
    try {
      const dbs = useDbStore.getState();
      if (dbs.active && ids.includes(dbs.active.id) && dbs.status === "on") {
        const err = await dbs.save(t("작업 전 저장"), true);
        if (err) return { ok: false, error: err };
      }
      const h = make({
        run: runLibraryJob,
        journalHeader: JOURNAL_HEADER,
        onProgress: (p) =>
          set((s) => (s.job ? { job: { ...s.job, phase: p.phase, fraction: p.fraction } } : s)),
      });
      jobHandle = h;
      return { ok: true, value: await h.promise };
    } catch (e) {
      if (e instanceof YxdbCancelled) return { ok: false, error: null };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      jobHandle = null;
      set({ job: null });
      await refresh();
      void pump();
    }
  };

  /** 지금 붙은(또는 붙는 중인) 항목 — 휴지통 · 옮기기에서 뺀다. */
  const attachedId = () => {
    const dbs = useDbStore.getState();
    return dbs.active && dbs.status !== "off" ? dbs.active.id : null;
  };

  return {
    loaded: false,
    entries: [],
    trashed: [],
    sizes: {},
    scan: null,
    notes: {},
    undo: null,
    job: null,
    selected: [],
    sources: [{ id: BROWSER_SOURCE_ID, kind: "browser", access: "granted" }],
    sourceId: readSourceId(),
    canOpenFolders: false,

    load: async () => {
      if (!db()) return set({ loaded: true, canOpenFolders: canOpenFolders() });
      await loadSourceViews();
      await syncFolders();
      await refresh();
      void pump();
    },

    create: async (title) => {
      const e = await createEntry(title, { select: false, source: get().sourceId });
      await refresh();
      return e;
    },

    importFile: async (file) => {
      if (!db()) return t("이 브라우저는 저장소(IndexedDB)를 쓸 수 없습니다");
      const source = get().sourceId;
      const src = sourceOf(source);
      if (!src) return t("라이브러리에 없는 폴더입니다");
      if (source === BROWSER_SOURCE_ID) {
        const room = await roomFor(file.size);
        if (room) return room;
      }
      const title = file.name.replace(/\.db$/i, "") || file.name;
      // 가져온 DB 의 커버는 «자동» — 통계 전 · 자유룰이면 일식, 주형이 잡히면 그 주형(2026-11-23 결정).
      const e = await createEntry(title, { select: false, source, mode: "auto" });
      if (!e) return t("이 브라우저는 저장소(IndexedDB)를 쓸 수 없습니다");
      try {
        await src.writeAtomic([{ name: e.file, data: file }]);
      } catch (err) {
        await discardEntry(e.id);
        await refresh();
        return err instanceof Error ? err.message : String(err);
      }
      const savedAt = (await src.stat(e.file))?.mtime ?? Date.now();
      await updateEntry(e.id, {
        fingerprint: await fingerprintOf(file, savedAt),
        updatedAt: savedAt,
      });
      await refresh();
      void pump();
      return null;
    },

    rename: async (id, title, alsoFile = true) => {
      const clean = title.trim();
      if (!clean || get().job?.ids.includes(id)) return null;
      const e = await getEntry(id);
      if (!e) return null;
      await updateEntry(id, { title: clean, updatedAt: Date.now() });
      set((s) => ({ entries: s.entries.map((x) => (x.id === id ? { ...x, title: clean } : x)) }));
      if (useDbStore.getState().active?.id === id)
        useDbStore.setState({ active: { id, title: clean } });
      const src = sourceOf(e.source);
      if (!alsoFile || !src || !isFolderSource(src)) return null;
      const want = await freeFileName(e.source, clean, id);
      if (want === e.file) {
        if (e.fileRenamePending) await updateEntry(id, {}, ["fileRenamePending"]);
        return null;
      }
      const dbs = useDbStore.getState();
      const attached = dbs.active?.id === id && dbs.status === "on";
      if (attached && dbs.busy) return t("DB 를 저장하는 중입니다. 끝난 뒤에 다시 하세요");
      // 엔진이 쥔 파일(데스크톱) — 저장 · 접고 뗀 뒤 옮기고 새 경로로 다시 붙인다. 떼지 않으면 다음 저장이 옛 이름을
      // 되살린다. 웹 엔진은 메모리 FS 의 사본이라 떼지 않는다(저장이 항목의 새 이름을 읽는다).
      let released = false;
      if (attached && dbs.location === "engine") {
        const err = await dbs.release();
        if (err) return err;
        released = true;
      }
      let note: string | null = null;
      try {
        if (await src.stat(e.file)) await src.rename(e.file, want);
        await updateEntry(id, { file: want }, ["fileRenamePending"]);
      } catch (err) {
        if (isBusyError(err)) {
          await updateEntry(id, { fileRenamePending: want });
          note = t(
            "다른 프로그램이 파일을 쓰는 중이라 파일 이름은 그대로 두었습니다. 다음에 다시 시도합니다",
          );
        } else note = err instanceof Error ? err.message : String(err);
      } finally {
        if (released) {
          const err = await useDbStore.getState().attach();
          if (err) note = note ?? err;
        }
      }
      await refresh();
      return note;
    },

    selectSource: (id) => {
      writeSourceId(id);
      set({ sourceId: id, selected: [] });
    },

    addFolder: async () => {
      try {
        const row = await addFolder();
        if (!row) return null;
        await loadSourceViews();
        get().selectSource(row.id);
        await syncFolders(row.id);
        await refresh();
        void pump();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },

    grantFolder: async (id) => {
      const src = folderSources().find((s) => s.id === id);
      if (!src) return t("라이브러리에 없는 폴더입니다");
      const access = await src.requestAccess();
      set((s) => ({ sources: s.sources.map((v) => (v.id === id ? { ...v, access } : v)) }));
      if (access !== "granted")
        return access === "missing"
          ? t("폴더 «{name}» 이(가) 없습니다", { name: src.label })
          : t("폴더를 쓸 권한을 받지 못했습니다");
      await syncFolders(id);
      await refresh();
      void pump();
      // 붙을 DB 가 이 폴더의 것이었으면 이제 붙인다.
      const dbs = useDbStore.getState();
      if (
        dbs.status === "error" &&
        get().entries.some((e) => e.id === dbs.active?.id && e.source === id)
      )
        void dbs.attach();
      return null;
    },

    removeFolder: async (id) => {
      const dbs = useDbStore.getState();
      const act = dbs.active ? get().entries.find((e) => e.id === dbs.active!.id) : null;
      if (act?.source === id && dbs.status !== "off")
        return t("붙어 있는 DB 의 폴더는 뺄 수 없습니다. 다른 DB 를 먼저 여세요");
      if (get().job) return t("다른 작업이 진행 중입니다");
      await saveManifest(id);
      await removeFolder(id);
      await loadSourceViews();
      await refresh();
      return null;
    },

    setCover: async (id, cover) => {
      await updateEntry(id, { cover });
      set((s) => ({ entries: s.entries.map((e) => (e.id === id ? { ...e, cover } : e)) }));
    },

    trash: async (id) => {
      const dbs = useDbStore.getState();
      if (readActiveId() === id && dbs.status !== "off")
        return t("붙어 있는 DB 는 지울 수 없습니다. 다른 DB 를 먼저 여세요");
      if (get().job?.ids.includes(id)) return t("작업 중인 DB 는 지울 수 없습니다");
      const e = await getEntry(id);
      if (!e) return null;
      if (get().scan?.id === id) current?.cancel();
      await trashEntry(id);
      if (dbs.active?.id === id) await dbs.loadStored();
      set((s) => ({
        undo: { ids: [id], title: e.title, at: Date.now() },
        selected: s.selected.filter((x) => x !== id),
      }));
      await refresh();
      return null;
    },

    trashMany: async (ids) => {
      const att = attachedId();
      const busy = get().job?.ids ?? [];
      const done: string[] = [];
      let title = "";
      for (const id of ids) {
        if (id === att || busy.includes(id)) continue;
        const e = await getEntry(id);
        if (!e) continue;
        if (get().scan?.id === id) current?.cancel();
        await trashEntry(id);
        done.push(id);
        title = e.title;
      }
      if (done.length)
        set({
          undo: {
            ids: done,
            title: done.length === 1 ? title : t("{n}개", { n: done.length }),
            at: Date.now(),
          },
        });
      set({ selected: [] });
      await refresh();
      return done.length < ids.length ? t("붙어 있거나 작업 중인 DB 는 남겼습니다") : null;
    },

    toggleSelect: (id) =>
      set((s) => ({
        selected: s.selected.includes(id)
          ? s.selected.filter((x) => x !== id)
          : [...s.selected, id],
      })),

    clearSelection: () => set({ selected: [] }),

    mergePreview: (ids, options) => runOp("merge", ids, (env) => previewMerge(ids, options, env)),

    merge: async (prep, title, trashOriginals) => {
      const base = get().entries.find((e) => e.id === prep.ids[0]);
      const r = await runOp("merge", prep.ids, (env) =>
        commitMerge(
          prep,
          {
            title: title.trim() || t("합친 DB"),
            cover: base?.cover ?? { mode: "eclipse", seed: 0 },
            trashOriginals,
            attachedId: attachedId(),
          },
          env,
        ),
      );
      if (!r.ok) return r;
      const trashed = r.value.trashed;
      set({
        selected: [],
        ...(trashed.length
          ? {
              undo: {
                ids: trashed,
                title: t("원본 {n}개", { n: trashed.length }),
                at: Date.now(),
              },
            }
          : {}),
      });
      return { ok: true, value: r.value.entry };
    },

    splitPreview: (id, base) => runOp("split", [id], (env) => previewSplit(id, base, env)),

    split: async (id, commit) => {
      if (commit.move && attachedId() === id)
        return { ok: false, error: t("붙어 있는 DB 에서는 옮길 수 없습니다. 복사로 나누세요") };
      const r = await runOp("split", [id], (env) => commitSplit(id, commit, env));
      return r.ok ? { ok: true, value: r.value.entries } : r;
    },

    cancelJob: () => jobHandle?.cancel(),

    restore: async (id) => {
      await restoreEntry(id);
      const u = get().undo;
      if (u?.ids.includes(id)) {
        const ids = u.ids.filter((x) => x !== id);
        set({ undo: ids.length ? { ...u, ids } : null });
      }
      await refresh();
      void pump();
    },

    purge: async (id) => {
      await purgeEntry(id);
      await refresh();
    },

    exportFile: async (id) => {
      const e = await getEntry(id);
      if (!e) return { error: t("라이브러리에 없는 DB 입니다") };
      const name = `${e.title}.db`;
      const dbs = useDbStore.getState();
      if (dbs.active?.id === id && dbs.status === "on") {
        if (dbs.location !== "engine") {
          const r = await dbs.exportFile();
          return "error" in r ? r : { file: r.file, name };
        }
        // 네이티브 엔진이 연 폴더의 파일 — 접어 저장시킨 뒤 그 파일을 읽는다.
        if (!dbs.settings.readonly) {
          const err = await dbs.save(t("내보내기 전 저장"), true);
          if (err) return { error: err };
        }
      }
      const src = sourceOf(e.source);
      if (!src) return { error: t("라이브러리에 없는 폴더입니다") };
      const [base, journal] = await Promise.all([src.open(e.file), src.stat(journalOf(e.file))]);
      if (!base) return { error: t("저장된 DB 파일이 없습니다") };
      if (journal && journal.size > JOURNAL_HEADER)
        return { error: t("저널에 접히지 않은 변경이 있습니다. DB 를 붙인 뒤 내보내세요") };
      return { file: base, name };
    },

    open: async (id, moves) => {
      const dbs = useDbStore.getState();
      const err = await dbs.switchTo(id);
      if (err) return err;
      // 꺼져 있으면 켠다 — 엔진이 떠 있으면 곧 붙고, 아니면 뜰 때 붙는다(`wireDatabase`).
      if (!useDbStore.getState().settings.enabled) {
        const e2 = await useDbStore.getState().setSettings({ enabled: true });
        if (e2) return e2;
      }
      const target =
        moves === "start"
          ? startMovesOf(
              get().entries.find((e) => e.id === id)?.stats,
              useBoardStore.getState().render.size,
              useStartMode.getState().mode,
            )
          : moves;
      if (target) {
        const title = (await getEntry(id))?.title ?? "";
        await keepBoardBefore(target);
        useGameStore.getState().loadMoves(target, {
          name: title,
          what:
            moves === "start" && target.length === 0
              ? t("라이브러리에서 «{title}», 빈 판에서 시작", { title })
              : moves === "start"
                ? t("라이브러리에서 «{title}»의 시작 국면({n}수)으로", { title, n: target.length })
                : t("라이브러리에서 {n}수 국면으로", { n: target.length }),
        });
      }
      await refresh();
      return null;
    },

    cancelScan: () => current?.cancel(),

    rescan: (id) => {
      set((s) => {
        const notes = { ...s.notes };
        delete notes[id];
        return { notes };
      });
      void pump();
    },
  };
});
