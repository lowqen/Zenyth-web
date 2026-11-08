import { useSyncExternalStore } from "react";
import { DESKTOP } from "../core/design/tokens";
import { DESKTOP_LAYOUT } from "./desktop/platform";

/**
 * 데스크톱 2열인가 — 데스크톱 Z5 ②(연구 화면). 데스크톱 배치(`DESKTOP_LAYOUT`)이고 창이 인스펙터가 옆에 붙는
 * 폭(`DESKTOP.inspectorBeside`, 1280) 이상일 때만. 웹 · 좁은 창은 한 줄 그대로다 — 화면 코드는 한 벌이고,
 * 2열은 같은 조각을 두 칸에 나눠 담을 뿐이다(계획 §5.A «넓이 분기»).
 */
const QUERY = `(min-width: ${DESKTOP.inspectorBeside}px)`;

export function useDesktopSplit(): boolean {
  const wide = useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(QUERY).matches,
  );
  return DESKTOP_LAYOUT && wide;
}
