import { NavLink, useLocation } from "react-router-dom";
import { useSlidingPill } from "../../components/useSlidingPill";
import { RESEARCH_TABS } from "../../app/destinations";
import { t } from "../../i18n/i18n";

/**
 * 연구 화면 안의 상단 탭 넷 — 앱 P2 처럼 폭을 똑같이 나눈 세그먼트(`RapfiSegmented(fill = true)`).
 *
 * 고른 탭의 알약은 칸 사이를 미끄러진다(앱 P5 ① — 판 밖의 크롬이라 허용, 결정 D6). **내용**은 미끄러지지
 * 않는다: 화면 전환은 `.quiet-switch` 크로스페이드 그대로다 — 보드를 읽는 중에 시선이 끌려가지 않게.
 */
export function ResearchTabs() {
  const { pathname } = useLocation();
  const track = useSlidingPill<HTMLDivElement>(pathname);
  return (
    <div ref={track} className="rtabs pilltrack" role="tablist" aria-label={t("연구")}>
      {RESEARCH_TABS.map((tab) => (
        <NavLink
          key={tab.path}
          to={tab.path}
          role="tab"
          className={({ isActive }) => "rtabs__tab" + (isActive ? " is-active" : "")}
        >
          {t(tab.label)}
        </NavLink>
      ))}
    </div>
  );
}
