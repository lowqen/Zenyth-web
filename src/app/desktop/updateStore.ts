import { create } from "zustand";

/**
 * 데스크톱 자동 업데이트의 상태(데스크톱 Z7). Tauri API 를 모른다 — 웹 번들에도 들어가도 되는 곳.
 * 확인 · 설치는 `updater.ts`(셸 안에서만 동적 import)가 하고, 화면(설정 ▸ 정보)은 이 상태만 읽는다.
 *
 * 흐름: 기동 뒤 조용히 한 번 확인 → 새 버전이면 판 위 안내 한 줄 → 사용자가 정보 화면에서 «설치하고 다시 시작».
 * 설치판(NSIS)은 받은 설치 파일을 passive 모드로 띄우고 앱은 곧바로 끝난다(엔진은 셸이 먼저 닫는다).
 * 포터블판은 설치판을 %LOCALAPPDATA% 에 까는 대신 알리기만 한다(`portable`).
 */
export type UpdatePhase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest" }
  | { kind: "available"; version: string; notes: string }
  | { kind: "downloading"; done: number; total: number | null }
  | { kind: "installing" }
  | { kind: "error"; message: string };

interface UpdateState {
  /** 셸의 버전(tauri.conf.json). 셸 밖이면 null. */
  appVersion: string | null;
  /** 포터블판(zip) — 자동 설치를 하지 않는다. */
  portable: boolean;
  phase: UpdatePhase;
  setInfo: (appVersion: string, portable: boolean) => void;
  setPhase: (phase: UpdatePhase) => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  appVersion: null,
  portable: false,
  phase: { kind: "idle" },
  setInfo: (appVersion, portable) => set({ appVersion, portable }),
  setPhase: (phase) => set({ phase }),
}));

/** 받은 양을 사람이 읽는 꼴로 — 진행 줄에만 쓴다. */
export function downloadProgress(done: number, total: number | null): string {
  const mb = (b: number) => (b / (1024 * 1024)).toFixed(1);
  return total ? `${mb(done)} / ${mb(total)} MB` : `${mb(done)} MB`;
}
