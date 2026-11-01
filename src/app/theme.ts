import { create } from "zustand";

/**
 * 테마 3상태 — `system`(기본) / `light` / `dark`.
 *
 * **데스크톱 `settings.txt` 27행이 오라클이다.** 사용자가 PC 설정을 불러오면 그
 * 값이 `light`/`dark` 로 **고정**되고 시스템 설정을 이긴다 — 앱과 같은 규칙이고,
 * 이유도 같다: PC 설정을 가져온 사람은 앱이 자기 PC 처럼 보이기를 기대한다.
 * (불러오기는 설정 ▸ 데스크톱 설정 파일 — `features/settings/desktopBridge.ts` 가 `setFromDesktopSettings` 를 부른다.)
 *
 * Material You(동적 색)는 앱이 의도적으로 거부했으므로 웹에도 없다.
 *
 * **검은 배경(AMOLED)** 은 다크 위에 덧씌우는 따로 된 켜짐/꺼짐이다(앱 P1 ②). 라이트에서는 아무것도
 * 바꾸지 않으므로 테마 3상태와 섞지 않는다 — `data-amoled` 하나를 붙이고, 어떤 토큰을 바꿀지는
 * tokens.css(생성물)의 덧씌움 블록이 정한다. 첫 프레임 전에는 `public/theme-init.js` 가 같은 열쇠를 읽는다.
 */
export type ThemeMode = "system" | "light" | "dark";

const KEY = "rapfi.theme";
const AMOLED_KEY = "rapfi.amoled";

function load(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    // 사생활 보호 모드 등에서는 접근 자체가 던진다. system 이 안전한 기본값이다.
    return "system";
  }
}

function apply(mode: ThemeMode) {
  const el = document.documentElement;
  if (mode === "system") delete el.dataset.theme;
  else el.dataset.theme = mode;
  try {
    if (mode === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch {
    /* 저장이 안 돼도 이번 세션은 정상 동작한다 */
  }
}

function loadAmoled(): boolean {
  try {
    return localStorage.getItem(AMOLED_KEY) === "1";
  } catch {
    return false;
  }
}

function applyAmoled(on: boolean) {
  const el = document.documentElement;
  if (on) el.dataset.amoled = "";
  else delete el.dataset.amoled;
  try {
    if (on) localStorage.setItem(AMOLED_KEY, "1");
    else localStorage.removeItem(AMOLED_KEY);
  } catch {
    /* 저장이 안 돼도 이번 세션은 정상 동작한다 */
  }
}

interface ThemeState {
  mode: ThemeMode;
  set: (mode: ThemeMode) => void;
  /** 검은 배경 — 다크일 때만 보인다(라이트에서는 켜 두어도 바뀌는 것이 없다). */
  amoled: boolean;
  setAmoled: (on: boolean) => void;
  /** settings.txt 27행 → 명시 고정. 데스크톱 설정 파일 가져오기(W5b)가 부른다. */
  setFromDesktopSettings: (darkFromLine27: boolean) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: load(),
  set: (mode) => {
    apply(mode);
    set({ mode });
  },
  amoled: loadAmoled(),
  setAmoled: (on) => {
    applyAmoled(on);
    set({ amoled: on });
  },
  setFromDesktopSettings: (dark) => {
    const mode: ThemeMode = dark ? "dark" : "light";
    apply(mode);
    set({ mode });
  },
}));
