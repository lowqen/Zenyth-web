/**
 * 데스크톱 단축키 판정 — DOM · Tauri 를 모르는 순수 함수(시험: keys.test.ts). 실제 연결은 bridge.ts.
 *
 * 웹뷰(WebView2)는 브라우저의 단축키를 그대로 가지고 있다. 앱 창에서 F5 · Ctrl+R 이 페이지를 새로 읽거나
 * Ctrl+P 가 인쇄 창을 띄우면 «앱»이 아니라 «웹 페이지»로 읽힌다 — 그런 키는 막는다.
 */

/** KeyboardEvent 에서 판정에 쓰는 부분만. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export type DesktopAction =
  | { kind: "open" }
  | { kind: "save" }
  | { kind: "rail"; index: number }
  | { kind: "fullscreen" }
  | { kind: "palette" }
  | { kind: "block" };

/**
 * 키 하나를 데스크톱 동작으로. `null` 이면 웹이 하던 대로 둔다(판 화면의 ← → 같은 키).
 *  - Ctrl+O 기보 열기 · Ctrl+S 기보 저장(.psq) · Ctrl+1…9 레일 n번째 · F11 전체 화면
 *  - Ctrl+K · Ctrl+Shift+P 명령 팔레트(Z4)
 *  - 막는 것: F5 · Ctrl+R · Ctrl+Shift+R(새로 읽기), Ctrl+P(인쇄), Ctrl+U(소스), Ctrl+J(내려받기 목록),
 *    Ctrl+Shift+I · Ctrl+Shift+J · F12(개발자 도구 — 배포판에는 원래 없지만 키가 먹는 것처럼 보이지 않게)
 */
export function desktopAction(e: KeyLike): DesktopAction | null {
  if (e.metaKey) return null;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (!e.ctrlKey && !e.altKey) {
    if (k === "F11" && !e.shiftKey) return { kind: "fullscreen" };
    if (k === "F5" || k === "F12") return { kind: "block" };
    return null;
  }
  if (!e.ctrlKey || e.altKey) return null;
  if (e.shiftKey) {
    if (k === "p") return { kind: "palette" };
    return k === "r" || k === "i" || k === "j" ? { kind: "block" } : null;
  }
  if (k === "k") return { kind: "palette" };
  if (k === "o") return { kind: "open" };
  if (k === "s") return { kind: "save" };
  if (/^[1-9]$/.test(k)) return { kind: "rail", index: Number(k) - 1 };
  if (k === "r" || k === "p" || k === "u" || k === "j" || k === "F5") return { kind: "block" };
  return null;
}

/**
 * Mica 를 깔아도 되는 Windows 인가 — `navigator.userAgentData` 의 `platformVersion` 주 번호가 13 이상이면
 * Windows 11 이다(Microsoft 문서 «User-Agent Client Hints 로 Windows 11 감지»). Windows 10 에서는 Mica 가
 * 없어서 투명 창 뒤가 그대로 비친다 — 그때는 불투명 면을 그대로 둔다.
 */
export function isWindows11(platform: string, platformVersion: string): boolean {
  if (platform !== "Windows") return false;
  const major = Number(platformVersion.split(".")[0]);
  return Number.isFinite(major) && major >= 13;
}
