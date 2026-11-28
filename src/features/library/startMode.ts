import { create } from "zustand";

/**
 * «DB 열 때 시작 국면»(설정 ▸ 일반 ▸ 라이브러리, L5-6 P3) — «이 DB 열기»가 판에 놓는 곳. 앱 `StartMode` 와 같은 값.
 *
 *  - `branch` 가장 큰 뿌리에서, 가장 무거운 자식이 그 아래의 9/10 이상인 동안 내려간 곳 — 기록이 갈라지는 곳(기본).
 *    엔진이 조회하며 남긴 빈 기록 때문에 가장 큰 뿌리가 빈 판이어도 실제 기록이 시작되는 곳에서 연다.
 *  - `root`   가장 큰 뿌리 그대로.
 *  - `empty`  늘 빈 판.
 *
 * 라이브러리 코드(색인 · 워커)를 끌고 오지 않도록 따로 둔다 — 설정 화면이 읽는다.
 */
export type StartMode = "branch" | "root" | "empty";

export const START_MODES: readonly StartMode[] = ["branch", "root", "empty"];

const KEY = "zenyth.library.openAt";

export const startModeOf = (v: unknown): StartMode =>
  v === "root" || v === "empty" ? v : "branch";

function load(): StartMode {
  try {
    return startModeOf(localStorage.getItem(KEY));
  } catch {
    return "branch";
  }
}

export const useStartMode = create<{ mode: StartMode; set: (m: StartMode) => void }>((set) => ({
  mode: typeof localStorage === "undefined" ? "branch" : load(),
  set: (mode) => {
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* 이번 세션만 */
    }
    set({ mode });
  },
}));
