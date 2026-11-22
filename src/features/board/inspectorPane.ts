import { create } from "zustand";

/**
 * 보드 옆 칸이 무엇을 펼치나 — **개요**(카드) 또는 **로그**(엔진 상태 · 콘솔). 넓은 보드의 인스펙터와 휴대폰
 * 세로 시트 머리의 세그먼트가 같은 값을 본다(라이브러리 계획 U2). 엔진 탭이 사라지며 `/engine` 주소와 명령
 * 팔레트의 «엔진 로그 보기»가 여기를 «로그»로 돌려놓고 보드로 간다 — 그래서 컴포넌트 상태가 아니라 스토어다.
 *
 * 저장 열쇠는 U1 의 인스펙터가 쓰던 것(`rapfi.open.inspector-log`) 그대로 — 옮길 저장값이 없다.
 */
export type InspectorPane = "overview" | "log";

const KEY = "rapfi.open.inspector-log";

function read(): InspectorPane {
  try {
    return localStorage.getItem(KEY) === "1" ? "log" : "overview";
  } catch {
    return "overview";
  }
}

interface PaneState {
  pane: InspectorPane;
  setPane: (pane: InspectorPane) => void;
}

export const useInspectorPane = create<PaneState>((set) => ({
  pane: read(),
  setPane: (pane) => {
    set({ pane });
    try {
      localStorage.setItem(KEY, pane === "log" ? "1" : "0");
    } catch {
      /* 이번 세션만 */
    }
  },
}));

/** 옆 칸을 «로그»로 — 보드로 가기 전에 부른다(`/engine` · 명령 팔레트). */
export function showEngineLog(): void {
  useInspectorPane.getState().setPane("log");
}
