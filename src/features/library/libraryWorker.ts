import { YxdbCancelled } from "../../core/database/yxdbfile";
import type { ScanProgress, ScanResult } from "../../core/database/yxdbindex";
import type { JobProgress } from "../../core/database/yxdbmerge";
import type {
  FromLibraryWorker,
  LibraryJob,
  LibraryJobResults,
  ScanJobOptions,
  ToLibraryWorker,
} from "./protocol";

/**
 * 라이브러리 워커 클라이언트 — 작업을 줄 세워 하나씩 맡긴다(§4 «작업 줄은 하나씩»). 워커는 처음 쓸 때 띄우고
 * 계속 둔다. 취소는 플래그 → 메시지, `CANCEL_GRACE_MS` 안에 답이 없으면 `terminate()` 하고 다음 작업에서 새로 띄운다.
 */

export interface LibraryScanOptions extends ScanJobOptions {
  onProgress?: (p: ScanProgress) => void;
}

export type LibraryScan = LibraryTask<ScanResult>;

const CANCEL_GRACE_MS = 1500;

let worker: Worker | null = null;
let nextId = 1;
let tail: Promise<unknown> = Promise.resolve();

function spawn(): Worker {
  // Vite 가 워커를 번들로 알아보려면 `new Worker(new URL(…))` 가 이 모양 그대로여야 한다.
  return new Worker(new URL("./library.worker.ts", import.meta.url), {
    type: "classic",
    name: "zenyth-library",
  });
}

const sharedFlag = (): Int32Array | undefined =>
  typeof SharedArrayBuffer !== "undefined" && globalThis.crossOriginIsolated
    ? new Int32Array(new SharedArrayBuffer(4))
    : undefined;

/** 작업 하나 — 끝나면 결과, 취소되면 `YxdbCancelled`. */
export interface LibraryTask<T> {
  readonly promise: Promise<T>;
  cancel(): void;
}

/**
 * 줄에 세워 워커에 맡긴다. `message` 는 id · 플래그를 받아 보낼 말을 만들고, `accept` 는 받은 말이 끝(결과)이면
 * 값을 돌려준다(진행이면 undefined).
 */
function enqueue<T>(
  message: (id: number, flag: Int32Array | undefined) => ToLibraryWorker,
  accept: (m: FromLibraryWorker) => { value: T } | undefined,
): LibraryTask<T> {
  const id = nextId++;
  const flag = sharedFlag();
  let cancelled = false;
  let abort: (() => void) | null = null;

  const run = () =>
    new Promise<T>((resolve, reject) => {
      if (cancelled) return reject(new YxdbCancelled());
      const w = (worker ??= spawn());
      let settled = false;
      let graceTimer: ReturnType<typeof setTimeout> | null = null;
      const finish = () => {
        settled = true;
        if (graceTimer) clearTimeout(graceTimer);
        w.removeEventListener("message", onMessage);
        w.removeEventListener("error", onError);
        abort = null;
      };
      const onMessage = (ev: MessageEvent<FromLibraryWorker>) => {
        const m = ev.data;
        if (m.id !== id) return;
        if (m.type === "cancelled") {
          finish();
          return reject(new YxdbCancelled());
        }
        if (m.type === "error") {
          finish();
          return reject(new Error(m.message));
        }
        const got = accept(m);
        if (!got) return;
        finish();
        resolve(got.value);
      };
      const onError = (e: ErrorEvent) => {
        finish();
        w.terminate();
        if (worker === w) worker = null;
        reject(new Error(e.message || "library worker crashed"));
      };
      abort = () => {
        if (flag) Atomics.store(flag, 0, 1);
        w.postMessage({ type: "cancel", id } satisfies ToLibraryWorker);
        graceTimer = setTimeout(() => {
          if (settled) return;
          // 동기 구간(정렬 따위)에 갇혀 있다 — 끊는다. 다음 작업이 새 워커를 띄운다.
          finish();
          w.terminate();
          if (worker === w) worker = null;
          reject(new YxdbCancelled());
        }, CANCEL_GRACE_MS);
      };
      w.addEventListener("message", onMessage);
      w.addEventListener("error", onError);
      w.postMessage(message(id, flag));
    });

  const promise = tail.then(run, run);
  tail = promise.catch(() => {});
  return {
    promise,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      abort?.();
    },
  };
}

/** 파일 하나의 통계(+ 색인). 앞 작업이 끝난 뒤에 시작한다. */
export function scanLibraryFile(file: Blob, opts: LibraryScanOptions = {}): LibraryScan {
  const { onProgress, ...options } = opts;
  return enqueue<ScanResult>(
    (id, flag) => {
      const msg: ToLibraryWorker = { type: "scan", id, file, options };
      if (flag) msg.cancelFlag = flag;
      return msg;
    },
    (m) => {
      if (m.type === "progress") onProgress?.(m.progress);
      return m.type === "done" ? { value: m.result } : undefined;
    },
  );
}

/** 병합 · 분리 작업(L3). 결과의 모양은 `job.kind` 가 정한다. */
export function runLibraryJob<J extends LibraryJob>(
  job: J,
  onProgress?: (p: JobProgress) => void,
): LibraryTask<LibraryJobResults[J["kind"]]> {
  return enqueue<LibraryJobResults[J["kind"]]>(
    (id, flag) => {
      const msg: ToLibraryWorker = { type: "job", id, job };
      if (flag) msg.cancelFlag = flag;
      return msg;
    },
    (m) => {
      if (m.type === "jobProgress") onProgress?.(m.progress);
      return m.type === "result" ? { value: m.result as LibraryJobResults[J["kind"]] } : undefined;
    },
  );
}
