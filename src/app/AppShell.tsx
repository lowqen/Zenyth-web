import { Suspense, useEffect, useRef } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useProMode } from "./proMode";
import { MiniAnalysisBar } from "./MiniAnalysisBar";
import { NavRail } from "./NavRail";
import { BottomTabs } from "./BottomTabs";
import { TopBar } from "./TopBar";
import { ResearchTabs } from "../features/research/ResearchTabs";
import { titleFor } from "./destinations";
import { useIsCompact } from "./useIsCompact";
import { useAutoBoot } from "./useAutoBoot";
import { RifImportLayer } from "../features/research/rif/RifImportLayer";
import { prefetchScreens } from "./screens";

/** 첫 화면이 그려지고 이만큼 지나 한가할 때 나머지 화면 조각을 받는다(screens.ts). */
const PREFETCH_DELAY_MS = 1500;

/**
 * 레일 + 상단 바 + 내용. 스낵바 호스트도 결국 여기 하나가 된다(앱과 같이).
 *
 * 좁은 폭(<640px)에서는 레일이 **하단 탭**으로 바뀐다 — 앱 모습 그대로다.
 * 640 은 앱의 `WideLayoutMin` 상수와 같은 값이고, W1 지시서의 분기점이기도 하다.
 */
export function AppShell() {
  const { pathname } = useLocation();
  const compact = useIsCompact();
  const { title } = titleFor(pathname);
  const inResearch = pathname.startsWith("/research");
  // 고급 사용자 모드를 끄는 순간 DB 화면에 있으면 보드로(앱과 같다 — 탭이 사라진 화면에 남지 않게).
  // 꺼진 채 주소로 DB 를 여는 것은 막지 않는다: 링크를 따라온 사람의 뜻이다.
  const pro = useProMode();
  const navigate = useNavigate();
  const wasPro = useRef(pro);
  useEffect(() => {
    if (wasPro.current && !pro && pathname.startsWith("/database")) navigate("/board");
    wasPro.current = pro;
  }, [pro, pathname, navigate]);
  // 앱이 뜨면 엔진을 뒤에서 띄운다 — 셸은 화면을 옮겨도 남으므로 한 번만 돈다.
  useAutoBoot();
  // 나머지 화면 조각은 첫 화면이 다 그려진 뒤 한가할 때 받아 둔다 — 첫 화면과 다투지 않고, 옮길 때는 기다림이 없다.
  useEffect(() => {
    const id = setTimeout(() => {
      if (typeof requestIdleCallback === "function") requestIdleCallback(prefetchScreens);
      else prefetchScreens();
    }, PREFETCH_DELAY_MS);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="shell" data-compact={compact || undefined}>
      {!compact && <NavRail />}
      {/* 보드 화면은 판의 나무색으로 물든다(앱 WoodTheme — tokens.css 의 [data-wood] 블록). 레일 · 하단 탭은 그대로. */}
      <div className="shell__main" data-wood={pathname.startsWith("/board") || undefined}>
        <TopBar title={title} />
        {inResearch && <ResearchTabs />}
        <main className="shell__content">
          {/* 보드 밖의 화면은 처음 열 때 받는 조각이다(screens.ts) — 받는 동안 내용 칸만 비운다. */}
          <Suspense fallback={null}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      {compact && (
        <div className="shell__bottom">
          <MiniAnalysisBar />
          <BottomTabs />
        </div>
      )}
      {/* W7: 어느 화면에 .rif 를 놓아도 변환하고, 진행 · 결과 카드를 띄운다. */}
      <RifImportLayer />
    </div>
  );
}
