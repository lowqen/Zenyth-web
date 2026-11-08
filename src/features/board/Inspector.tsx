import type { KeyboardEvent, ReactNode } from "react";
import { useRememberedOpen } from "../../components/useRememberedOpen";
import { useSlidingPill } from "../../components/useSlidingPill";
import { EngineConsole } from "../engine/EngineConsole";
import { msg, t } from "../../i18n/i18n";

type Pane = "overview" | "log";

const PANES: readonly { pane: Pane; label: string }[] = [
  { pane: "overview", label: msg("개요") },
  { pane: "log", label: msg("로그") },
];

/**
 * 데스크톱 보드의 오른쪽 인스펙터 — 데스크톱 Z5(계획 §4, Mornye 의 오른쪽 인스펙터 패널).
 *
 * 위에 세그먼트 둘: **개요**(국면 · 엔진 · 형세 · 분석 설정 — 웹 옆 칸의 카드 그대로)와 **로그**(엔진 콘솔을 칸
 * 높이 전부로). 웹 보드의 접이식 «엔진 로그»가 여기서 칸 하나가 된다 — 프로토콜을 좇으며 분석할 때 콘솔이
 * 카드 사이에 끼어 손바닥만 하던 것을 걷는다. «DB» 칸은 따로 두지 않는다: 지금 국면의 DB 값 · 주석은 국면
 * 카드가, 자식 값은 판의 칩이 이미 말한다(같은 것을 두 곳에 그리지 않는다).
 *
 * 탭 안의 탭이 아니다 — 위의 [분석] | [대국] 은 엔진의 쓰임을 가르고, 이것은 같은 칸에 무엇을 펼칠지다.
 * 세그먼트는 WAI-ARIA 탭 패턴(고른 칸만 Tab 순서, ← → 로 옮김). 고른 칸은 기억된다.
 */
export function Inspector({
  id,
  label,
  children,
}: {
  /** 판 위 [분석] | [대국] 탭이 `aria-controls` 로 가리키는 칸 id. */
  id: string;
  label: string;
  children: ReactNode;
}) {
  const [logOpen, setLogOpen] = useRememberedOpen("inspector-log");
  const pane: Pane = logOpen ? "log" : "overview";
  const track = useSlidingPill<HTMLDivElement>(pane);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    // 판의 ← → (기보 이동)와 겹치지 않게 여기서 멈춘다.
    e.preventDefault();
    e.stopPropagation();
    const next: Pane = pane === "log" ? "overview" : "log";
    setLogOpen(next === "log");
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-pane="${next}"]`)?.focus();
  };

  return (
    <aside id={id} className="inspector" role="tabpanel" aria-label={label}>
      <div
        ref={track}
        className="inspector__seg modetabs pilltrack"
        role="tablist"
        aria-label={t("인스펙터")}
        onKeyDown={onKey}
      >
        {PANES.map((p) => (
          <button
            key={p.pane}
            type="button"
            role="tab"
            className="modetabs__tab"
            data-pane={p.pane}
            aria-selected={pane === p.pane}
            tabIndex={pane === p.pane ? 0 : -1}
            onClick={() => setLogOpen(p.pane === "log")}
          >
            {t(p.label)}
          </button>
        ))}
      </div>
      {pane === "log" ? (
        <div className="inspector__log">
          <EngineConsole />
        </div>
      ) : (
        <div className="inspector__body boardscreen__side">{children}</div>
      )}
    </aside>
  );
}
