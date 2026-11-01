import { useLayoutEffect, useRef } from "react";

/**
 * 세그먼트의 선택 알약을 **하나의 면이 미끄러지는** 모양으로 — 앱 P5 ① 의 `RapfiSegmented`.
 *
 * 묶음(`.pilltrack`)의 `::before` 가 알약이고, 이 훅은 고른 칸의 자리와 크기를 CSS 변수(`--pill-x` · `--pill-y` ·
 * `--pill-w` · `--pill-h`)로 넣을 뿐이다. 움직임은 CSS 가 진다(판 밖 크롬이라 미끄러짐이 허용된다 — 앱 결정 D6).
 *
 * - 처음 자리는 **건너뛰기**(transition 없음): 화면을 열 때 알약이 왼쪽에서 자라나지 않게. 자리를 잡은 뒤에야
 *   `data-pill="ready"` 가 붙고, 그때부터 칸 사이를 미끄러진다.
 * - JS 가 돌기 전(그리고 고른 칸이 없을 때)에는 각 칸이 자기 배경으로 선택을 말한다 — CSS 가 `ready` 일 때만
 *   칸의 배경을 비운다.
 * - 크기가 바뀌면(글꼴 로드 · 언어 · 폭) 다시 잰다.
 *
 * `key` 는 고른 것이 바뀌었음을 알리는 값(고른 값 · 경로)이다.
 */
export function useSlidingPill<T extends HTMLElement>(key: unknown) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const on = el.querySelector<HTMLElement>(
        ':scope > [aria-selected="true"], :scope > [aria-checked="true"], :scope > [aria-current="page"]',
      );
      if (!on) {
        el.style.setProperty("--pill-w", "0px");
        return;
      }
      el.style.setProperty("--pill-x", `${on.offsetLeft}px`);
      el.style.setProperty("--pill-y", `${on.offsetTop}px`);
      el.style.setProperty("--pill-w", `${on.offsetWidth}px`);
      el.style.setProperty("--pill-h", `${on.offsetHeight}px`);
      if (!el.dataset.pill) requestAnimationFrame(() => (el.dataset.pill = "ready"));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [key]);
  return ref;
}
