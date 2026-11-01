import { useEffect, useRef } from "react";
import { usePageTitle } from "./pageTitleStore";

/**
 * 목록 화면의 큰 제목 — 앱 UI 개편 2차 M2(Mornye 의 «설정» · «디자인»).
 *
 * 화면 맨 위에 34 ExtraBold 로 크게 서 있다가, 스크롤해서 그 줄이 사라지면 상단 바의 한 줄 제목이
 * 나타난다(앱의 큰 상단 바가 접히는 것과 같다). 판이 있는 화면은 쓰지 않는다 — 큰 머리가 판 높이를
 * 빼앗는다(앱 P2 ③ · M2 의 같은 판단).
 *
 * 상단 바의 제목은 지우지 않고 **투명하게만** 한다: 위치를 말하는 글(스모크가 읽는 `.topbar__title`)이
 * 화면 낭독기와 시험에 늘 남고, 접힐 때 상단 바의 높이가 흔들리지 않는다. 큰 제목은 같은 말을 한 번 더
 * 하는 그림이라 `aria-hidden` 이다.
 */
export function PageTitle({ children }: { children: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = usePageTitle.getState().setShowing;
    // 스크롤 상자는 셸의 내용 칸이다. 상단 바 아래로 제목이 다 사라졌을 때 접힌다.
    const root = el.closest(".shell__content");
    const io = new IntersectionObserver(([e]) => set(e?.isIntersecting ?? false), {
      root,
      threshold: 0,
    });
    io.observe(el);
    return () => {
      io.disconnect();
      set(false);
    };
  }, []);
  return (
    <p ref={ref} className="pagetitle" aria-hidden="true">
      {children}
    </p>
  );
}
