/// <reference lib="webworker" />
import { createLibraryJobs } from "./libraryJobs";
import type { FromLibraryWorker, ToLibraryWorker } from "./protocol";

/**
 * 라이브러리 워커 — yixindb 통계 · 색인(`core/database/yxdbindex.ts`). 파일을 흘려 읽어 풀린 바이트를 통째로 들지
 * 않는다(표본 79MB → 풀면 668MB, 색인은 레코드당 약 17B). 이 파일은 사용자의 기기 안에서만 돈다.
 */

const scope = self as unknown as DedicatedWorkerGlobalScope;
const jobs = createLibraryJobs((m: FromLibraryWorker) => scope.postMessage(m), {
  deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
});

scope.onmessage = (ev: MessageEvent<ToLibraryWorker>) => {
  void jobs.handle(ev.data);
};
