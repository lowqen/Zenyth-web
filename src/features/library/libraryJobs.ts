import { YxdbCancelled } from "../../core/database/yxdbfile";
import { indexBudget, scanYxdb } from "../../core/database/yxdbindex";
import { BUSY, type FromLibraryWorker, type ToLibraryWorker } from "./protocol";

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
    const { options } = msg;
    try {
      const result = await scanYxdb(msg.file, {
        index: options.index ?? true,
        maxIndexBytes: options.maxIndexBytes ?? indexBudget(env.deviceMemory),
        ...(options.rootsTop !== undefined ? { rootsTop: options.rootsTop } : {}),
        onProgress: (progress) => post({ type: "progress", id: job.id, progress }),
        isCancelled: () => job.cancelled || (job.flag ? Atomics.load(job.flag, 0) !== 0 : false),
      });
      post({ type: "done", id: job.id, result });
    } catch (e) {
      if (e instanceof YxdbCancelled) post({ type: "cancelled", id: job.id });
      else post({ type: "error", id: job.id, message: e instanceof Error ? e.message : String(e) });
    } finally {
      current = null;
    }
  }

  return { handle, busy: () => current !== null };
}
