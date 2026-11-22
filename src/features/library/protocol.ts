import type { ScanProgress, ScanResult } from "../../core/database/yxdbindex";

/**
 * 라이브러리 워커와 주고받는 말(라이브러리 계획 §4). 작업은 전용 워커 하나에서 하나씩 — UI · 엔진 스레드와
 * 따로 돈다. 취소는 협조 플래그(교차 출처 격리면 `SharedArrayBuffer`, 아니면 `cancel` 메시지 — 스트림 읽기 사이에
 * 처리된다)이고, 그래도 답이 없으면 클라이언트가 워커를 `terminate()` 한다.
 */

export interface ScanJobOptions {
  /** 색인(주형 · 뿌리)까지. 기본 켬. */
  index?: boolean;
  /** 색인 메모리 상한(바이트). 없으면 워커가 `navigator.deviceMemory` 로 정한다(`indexBudget`). */
  maxIndexBytes?: number;
  /** 뿌리 상위 몇 개. 기본 32. */
  rootsTop?: number;
}

export type ToLibraryWorker =
  | {
      type: "scan";
      id: number;
      /** `File` 또는 Dexie 에 둔 `Blob` — 워커가 `stream()` 으로 흘려 읽는다(복사 없음). */
      file: Blob;
      options: ScanJobOptions;
      /** `SharedArrayBuffer` 위 Int32 하나 — 0 이 아니면 취소. */
      cancelFlag?: Int32Array;
    }
  | { type: "cancel"; id: number };

export type FromLibraryWorker =
  | { type: "progress"; id: number; progress: ScanProgress }
  | { type: "done"; id: number; result: ScanResult }
  | { type: "cancelled"; id: number }
  | { type: "error"; id: number; message: string };

/** 워커가 이미 다른 작업 중일 때의 부호 — 클라이언트가 줄을 세우므로 보통은 나오지 않는다. */
export const BUSY = "BUSY";
