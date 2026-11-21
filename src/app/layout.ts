import { useSyncExternalStore } from "react";
import { DESKTOP, LAYOUT } from "../core/design/tokens";
import { DESKTOP_LAYOUT } from "./desktop/platform";

/**
 * 화면 배치 판정 — 웹 · 데스크톱 한 벌(engineering-notes §13).
 *
 * 화면이 «어떤 배치로 그릴지» 묻는 곳은 모두 여기를 거친다. 폭 분기점은 `tokens.ts` 에서만 읽고(CSS 의 `@media` 와
 * 같은 값), 데스크톱 배치 여부는 `DESKTOP_LAYOUT` 하나로 본다. Tauri API 를 불러도 되는가(`IS_DESKTOP`)는 배치가
 * 아니라 기능이므로 여기서 다루지 않는다.
 *
 * `window.innerWidth` 를 resize 로 좇지 않고 `matchMedia` 를 쓴다 — 브라우저가 이미 아는 것을 다시 계산하면
 * 스크롤 중에도 리렌더가 돈다. 외부 값의 구독이라 `useSyncExternalStore` — 첫 렌더부터 지금 값을 읽는다.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

const COMPACT = `(max-width: ${LAYOUT.compactMax}px)`;
/** 휴대폰 세로 — 판 고정 + 시트(결정 Q4). 넓은 화면과 가로 화면은 두 칸 그대로다. */
const SHEET = `(max-width: ${LAYOUT.compactMax}px) and (orientation: portrait)`;
/**
 * 데스크톱 보드(데스크톱 Z5) — 판 밑에 상태 캡슐 · 이동 바를 붙이고 옆 칸을 인스펙터로 쓰는 폭. 이보다 좁거나
 * 세로로 선 창은 웹의 반응형 배치를 그대로 쓴다(1024 세로는 웹이 판 밑으로 쌓는 분기점이다 — base.css).
 */
const DESK_BOARD = `(min-width: ${LAYOUT.boardStack}px) and (orientation: landscape)`;
/** 데스크톱 2열 — 인스펙터가 내용 옆에 붙는 폭(`DESKTOP.inspectorBeside`). */
const DESK_SPLIT = `(min-width: ${DESKTOP.inspectorBeside}px)`;

/** 좁은 폭인가 — 내비게이션이 하단 탭으로 바뀐다(`LAYOUT.compactMax`). 웹 · 데스크톱 공통. */
export function useIsCompact(): boolean {
  return useMediaQuery(COMPACT);
}

/** 판 고정 + 시트 배치인가(휴대폰 세로). 웹 · 데스크톱 공통. */
export function useSheetLayout(): boolean {
  return useMediaQuery(SHEET);
}

/** 데스크톱 보드 배치인가 — 데스크톱 배치이고 창이 넓게 누웠을 때만. */
export function useDeskLayout(): boolean {
  return useMediaQuery(DESK_BOARD) && DESKTOP_LAYOUT;
}

/**
 * 데스크톱 2열인가 — 데스크톱 Z5 ②(연구 · DB · 설정 화면). 데스크톱 배치이고 창이 `DESKTOP.inspectorBeside` 이상일
 * 때만. 웹 · 좁은 창은 한 줄 그대로다 — 2열은 같은 조각을 두 칸에 나눠 담을 뿐이다(계획 §5.A «넓이 분기»).
 */
export function useDesktopSplit(): boolean {
  return useMediaQuery(DESK_SPLIT) && DESKTOP_LAYOUT;
}
