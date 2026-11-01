import { NavLink, useLocation } from "react-router-dom";
import { visibleRail } from "./destinations";
import { useProMode } from "./proMode";
import { t } from "../i18n/i18n";

/**
 * 좁은 폭(<640px)의 하단 탭 — 앱 모습 그대로.
 *
 * 레일과 **같은 항목**이다: 기본 다섯, 고급 사용자 모드면 DB 를 더한 여섯(앱과 같다). 앱 M6 처럼 고른 탭은
 * 채운 아이콘 + 아이콘 뒤의 연한 알약 + 굵은 라벨, 나머지는 외곽선 아이콘이고, 바 면은 surface-container 다.
 */
export function BottomTabs() {
  const { pathname } = useLocation();
  const rail = visibleRail(useProMode());
  return (
    <nav className="tabs" aria-label={t("주 메뉴")}>
      {rail.map((d) => {
        const on = pathname === d.path || pathname.startsWith(d.path + "/");
        return (
          <NavLink
            key={d.path}
            to={d.path}
            className={"tabs__link" + (on ? " is-active" : "")}
            aria-current={on ? "page" : undefined}
          >
            <span className="tabs__pill">
              <svg className="tabs__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d={on ? d.iconOn : d.icon} />
              </svg>
            </span>
            <span className="tabs__label">{t(d.label)}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
