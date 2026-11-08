import { useSyncExternalStore } from "react";
import { DESKTOP_LAYOUT } from "../../app/desktop/platform";

/** 휴대폰 세로 — 판 고정 + 시트(결정 Q4). 넓은 화면과 가로 화면은 두 칸 그대로다. */
const SHEET_QUERY = "(max-width: 640px) and (orientation: portrait)";

/**
 * 데스크톱 보드(데스크톱 Z5) — 판 밑에 상태 캡슐 · 이동 바를 붙이고 옆 칸을 인스펙터로 쓰는 폭. 이보다 좁거나
 * 세로로 선 창은 웹의 반응형 배치를 그대로 쓴다(1024 세로는 웹이 판 밑으로 쌓는 분기점이다 — base.css).
 */
const DESK_QUERY = "(min-width: 1024px) and (orientation: landscape)";

function useQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

/** 지금 폭이 시트 배치인가. */
export function useSheetLayout(): boolean {
  return useQuery(SHEET_QUERY);
}

/** 지금 데스크톱 보드 배치인가 — 데스크톱 배치(`DESKTOP_LAYOUT`)이고 창이 넓게 누웠을 때만. */
export function useDeskLayout(): boolean {
  const wide = useQuery(DESK_QUERY);
  return DESKTOP_LAYOUT && wide;
}
