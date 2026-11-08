/**
 * zenyth-desktop(Tauri 셸) 안에서 도는가 — 데스크톱 Z2.
 *
 * 셸은 페이지 스크립트보다 먼저 `__TAURI_INTERNALS__` 를 심는다. 웹 배포에서는 언제나 거짓이고,
 * 이 값이 거짓이면 데스크톱 코드(`app/desktop/*`)는 불리지도 받아지지도 않는다(동적 import).
 * 첫 프레임 전의 `data-desktop` 은 `public/theme-init.js` 가 같은 검사로 붙인다(밀도 토큰 · 타이틀바 칸).
 */
export const IS_DESKTOP: boolean = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
