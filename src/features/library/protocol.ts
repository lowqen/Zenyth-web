import type { ScanProgress, ScanResult } from "../../core/database/yxdbindex";
import type { JobProgress, MergePolicy, MergeSummary } from "../../core/database/yxdbmerge";
import type { SplitBase, SplitCounts, SplitPlan } from "../../core/database/yxdbsplit";

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

export interface MergeJobOptions {
  policy: MergePolicy;
  joinComments: boolean;
}

/** 병합 입력 — 순서가 아닌 파일은 정렬 묶음 여럿이 같은 `rank` 를 갖는다(`mergeCount` 가 만든다). */
export interface MergeJobSource {
  blob: Blob;
  rank: number;
}

/**
 * 병합 · 분리(L3) — 미리 보기(`…Count`)와 쓰기(`…Write`)가 따로다. 쓰기는 결과를 다시 읽어 레코드 수를 맞춘 뒤에만
 * `Blob` 을 돌려준다(원자적 쓰기 — 소스에 놓는 것은 메인 스레드).
 */
export type LibraryJob =
  | { kind: "mergeCount"; files: Blob[]; options: MergeJobOptions }
  | { kind: "mergeWrite"; sources: MergeJobSource[]; options: MergeJobOptions; count: number }
  | { kind: "splitCount"; file: Blob; base: SplitBase | null; withOpenings: boolean }
  | { kind: "splitWrite"; file: Blob; plan: SplitPlan; meta: boolean };

export interface LibraryJobResults {
  mergeCount: { summary: MergeSummary; sources: MergeJobSource[] };
  mergeWrite: { file: Blob; records: number };
  splitCount: SplitCounts;
  splitWrite: { files: Blob[]; counts: number[] };
}

export type LibraryJobResult = LibraryJobResults[keyof LibraryJobResults];

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
  | { type: "job"; id: number; job: LibraryJob; cancelFlag?: Int32Array }
  | { type: "cancel"; id: number };

export type FromLibraryWorker =
  | { type: "progress"; id: number; progress: ScanProgress }
  | { type: "done"; id: number; result: ScanResult }
  | { type: "jobProgress"; id: number; progress: JobProgress }
  | { type: "result"; id: number; result: LibraryJobResult }
  | { type: "cancelled"; id: number }
  | { type: "error"; id: number; message: string };

/** 워커가 이미 다른 작업 중일 때의 부호 — 클라이언트가 줄을 세우므로 보통은 나오지 않는다. */
export const BUSY = "BUSY";
