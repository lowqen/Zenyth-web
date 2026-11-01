import { useSyncExternalStore } from "react";

/** 휴대폰 세로 — 판 고정 + 시트(결정 Q4). 넓은 화면과 가로 화면은 두 칸 그대로다. */
const SHEET_QUERY = "(max-width: 640px) and (orientation: portrait)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(SHEET_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** 지금 폭이 시트 배치인가. */
export function useSheetLayout(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(SHEET_QUERY).matches);
}
