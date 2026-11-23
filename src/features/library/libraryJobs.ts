import { YxdbCancelled } from "../../core/database/yxdbfile";
import { indexBudget, scanYxdb } from "../../core/database/yxdbindex";
import {
  blobSpill,
  countYxdb,
  mergeYxdb,
  sortedRuns,
  YxdbUnsorted,
  type JobProgress,
} from "../../core/database/yxdbmerge";
import { countSplit, runSplit } from "../../core/database/yxdbsplit";
import {
  BUSY,
  type FromLibraryWorker,
  type LibraryJob,
  type LibraryJobResult,
  type MergeJobSource,
  type ToLibraryWorker,
} from "./protocol";

/**
 * 라이브러리 워커의 몸통 — 메시지를 받아 작업을 돌린다. 워커 전역(`self`)에 기대지 않아 node 시험에서도 돈다
 * (`library.worker.ts` 는 이것과 `postMessage` 를 잇기만 한다).
 */

export interface LibraryJobsEnv {
  /** `navigator.deviceMemory`(GB) — 메모리 관문. */
  deviceMemory?: number | undefined;
}

export function createLibraryJobs(post: (m: FromLibraryWorker) => void, env: LibraryJobsEnv = {}) {
  let current: { id: number; cancelled: boolean; flag: Int32Array | undefined } | null = null;

  async function handle(msg: ToLibraryWorker): Promise<void> {
    if (msg.type === "cancel") {
      if (current?.id === msg.id) current.cancelled = true;
      return;
    }
    if (current) {
      post({ type: "error", id: msg.id, message: BUSY });
      return;
    }
    const job = { id: msg.id, cancelled: false, flag: msg.cancelFlag };
    current = job;
    const isCancelled = () => job.cancelled || (job.flag ? Atomics.load(job.flag, 0) !== 0 : false);
    try {
      if (msg.type === "scan") {
        const { options } = msg;
        const result = await scanYxdb(msg.file, {
          index: options.index ?? true,
          maxIndexBytes: options.maxIndexBytes ?? indexBudget(env.deviceMemory),
          ...(options.rootsTop !== undefined ? { rootsTop: options.rootsTop } : {}),
          onProgress: (progress) => post({ type: "progress", id: job.id, progress }),
          isCancelled,
        });
        post({ type: "done", id: job.id, result });
      } else {
        // 진행은 10Hz 로 묶는다(끝 1 은 늘 보낸다)
        let last = -1e9;
        const onProgress = (progress: JobProgress) => {
          const now = performance.now();
          if (now - last < 100 && progress.fraction < 1) return;
          last = now;
          post({ type: "jobProgress", id: job.id, progress });
        };
        const result = await runJob(msg.job, { isCancelled, onProgress }, env);
        post({ type: "result", id: job.id, result });
      }
    } catch (e) {
      if (e instanceof YxdbCancelled) post({ type: "cancelled", id: job.id });
      else post({ type: "error", id: job.id, message: e instanceof Error ? e.message : String(e) });
    } finally {
      current = null;
    }
  }

  return { handle, busy: () => current !== null };
}

interface JobCtx {
  isCancelled: () => boolean;
  onProgress: (p: JobProgress) => void;
}

/** 쓰기 결과를 다시 읽어 레코드 수를 맞춘다(원자적 쓰기 ②). */
async function verify(file: Blob, want: number, ctx: JobCtx): Promise<void> {
  ctx.onProgress({ phase: "verify", fraction: 0 });
  const got = await countYxdb(file, ctx.isCancelled);
  if (got !== want) throw new Error(`결과 파일의 레코드 수가 다릅니다(${got} ≠ ${want})`);
  ctx.onProgress({ phase: "verify", fraction: 1 });
}

export async function runJob(
  job: LibraryJob,
  ctx: JobCtx,
  env: LibraryJobsEnv = {},
): Promise<LibraryJobResult> {
  const maxIndexBytes = indexBudget(env.deviceMemory);
  switch (job.kind) {
    case "mergeCount": {
      let sources: MergeJobSource[] = job.files.map((blob, rank) => ({ blob, rank }));
      const sorted = new Set<number>();
      for (;;) {
        try {
          const summary = await mergeYxdb(sources, { ...job.options, ...ctx });
          return { summary, sources };
        } catch (e) {
          // 순서가 아닌 입력 — 정렬 묶음으로 바꿔 다시(입력마다 한 번)
          if (!(e instanceof YxdbUnsorted) || sorted.has(e.rank)) throw e;
          sorted.add(e.rank);
          const runs = await sortedRuns(job.files[e.rank]!, () => blobSpill(), {
            isCancelled: ctx.isCancelled,
            onProgress: (f) => ctx.onProgress({ phase: "sort", fraction: f }),
          });
          sources = [
            ...sources.filter((s) => s.rank !== e.rank),
            ...runs.map((blob) => ({ blob, rank: e.rank })),
          ];
        }
      }
    }
    case "mergeWrite": {
      const spill = blobSpill();
      await mergeYxdb(
        job.sources,
        { ...job.options, ...ctx },
        {
          count: job.count,
          sink: (c) => spill.write(c),
        },
      );
      const file = spill.finish();
      await verify(file, job.count, ctx);
      return { file, records: job.count };
    }
    case "splitCount":
      return countSplit(job.file, job.base, {
        withOpenings: job.withOpenings,
        maxIndexBytes,
        ...ctx,
      });
    case "splitWrite": {
      const n = job.plan.outputs.length + (job.plan.rest ? 1 : 0);
      const spills = Array.from({ length: n }, () => blobSpill());
      const counts = await runSplit(
        job.file,
        job.plan,
        spills.map((s) => (c: Uint8Array) => s.write(c)),
        job.meta,
        { maxIndexBytes, ...ctx },
      );
      const files = spills.map((s) => s.finish());
      for (const [i, f] of files.entries()) await verify(f, counts[i]! + (job.meta ? 1 : 0), ctx);
      return { files, counts };
    }
  }
}
