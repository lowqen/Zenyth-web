/**
 * zenyth-desktop(Tauri 셸) 안에서 도는가 — 데스크톱 Z2.
 *
 * 셸은 페이지 스크립트보다 먼저 `__TAURI_INTERNALS__` 를 심는다. 웹 배포에서는 언제나 거짓이고,
 * 이 값이 거짓이면 데스크톱 코드(`app/desktop/*`)는 불리지도 받아지지도 않는다(동적 import).
 * 첫 프레임 전의 `data-desktop` 은 `public/theme-init.js` 가 같은 검사로 붙인다(밀도 토큰 · 타이틀바 칸).
 */
export const IS_DESKTOP: boolean = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * 데스크톱 **배치**를 쓰는가 — 데스크톱 Z5. 셸 안이면 `theme-init.js` 가 첫 프레임 전에 붙이는 `data-desktop`
 * 을 그대로 읽는다(CSS 의 `:root[data-desktop]` 과 같은 판정).
 *
 * `IS_DESKTOP` 과 나눈 이유: 그것은 Tauri API 를 불러도 되는가이고, 이것은 화면을 데스크톱 문법(펼친 레일 ·
 * 인스펙터 · 상태 캡슐)으로 그리는가다. 스크린샷 골든(`scripts/shots.ts` 의 `desktop` 폭)은 일반 브라우저에서
 * 속성만 붙여 배치를 찍는다 — 셸 API 없이. 웹 배포에서는 둘 다 언제나 거짓이다.
 */
export const DESKTOP_LAYOUT: boolean =
  typeof document !== "undefined" && document.documentElement.hasAttribute("data-desktop");
