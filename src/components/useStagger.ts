import { useEffect, useState } from "react";

/**
 * 목록의 첫 등장 스태거(Z9 — 앱 `rememberStagger` · `staggerIn`, P5): 처음 10개가 40ms 간격으로 12px 떠오르며
 * 나타난다. **이 페이지에서 그 목록을 처음 볼 때만** — 탭을 오가거나 돌아올 때마다 다시 기다리게 하는 목록은
 * 기다리게 하는 목록이다. 감속 모드(`prefers-reduced-motion`)면 CSS 가 끈다. 판에는 쓰지 않는다.
 *
 * 돌려준 클래스를 목록 컨테이너에 붙인다 — 직계 자식이 항목이다.
 */
const played = new Set<string>();

export function useStagger(key: string): string {
  // 첫 그리기에서 정한다 — StrictMode 의 두 번 호출에도 같은 답이 되게 기록은 효과에서.
  const [play] = useState(() => !played.has(key));
  useEffect(() => {
    played.add(key);
  }, [key]);
  return play ? " stagger" : "";
}
