import type { KeyboardEvent, ReactNode } from "react";
import { useSlidingPill } from "../../components/useSlidingPill";
import { EngineLogPane } from "../engine/EngineLogPane";
import { msg, t } from "../../i18n/i18n";
import { useInspectorPane, type InspectorPane } from "./inspectorPane";

const PANES: readonly { pane: InspectorPane; label: string }[] = [
  { pane: "overview", label: msg("개요") },
  { pane: "log", label: msg("로그") },
];

/**
 * 보드 옆 칸의 세그먼트 [개요 | 로그] — 넓은 보드의 인스펙터 머리와 휴대폰 세로 시트 머리가 같은 것을 쓴다
 * (라이브러리 계획 U2 — 두 폭이 같은 구조). 고른 칸은 `inspectorPane` 스토어에 있고 기억된다.
 *
 * 탭 안의 탭이 아니다 — 판 위의 [분석] | [대국] 은 엔진의 쓰임을 가르고, 이것은 같은 칸에 무엇을 펼칠지다.
 * 세그먼트는 WAI-ARIA 탭 패턴(고른 칸만 Tab 순서, ← → 로 옮김).
 */
export function PaneTabs({ className = "" }: { className?: string }) {
  const pane = useInspectorPane((s) => s.pane);
  const setPane = useInspectorPane((s) => s.setPane);
  const track = useSlidingPill<HTMLDivElement>(pane);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    // 판의 ← → (기보 이동)와 겹치지 않게 여기서 멈춘다.
    e.preventDefault();
    e.stopPropagation();
    const next: InspectorPane = pane === "log" ? "overview" : "log";
    setPane(next);
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-pane="${next}"]`)?.focus();
  };

  return (
    <div
      ref={track}
      className={`panetabs modetabs pilltrack ${className}`.trim()}
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
          onClick={() => setPane(p.pane)}
        >
          {t(p.label)}
        </button>
      ))}
    </div>
  );
}

/**
 * 보드의 옆 칸 인스펙터 — 데스크톱 Z5(계획 §4, Mornye 의 오른쪽 인스펙터 패널). 데스크톱에서 시작해 넓은 웹
 * 보드도 같은 것을 쓴다(라이브러리 계획 U1).
 *
 * 위에 세그먼트 둘: **개요**(국면 · 엔진 · 형세 · 분석 설정 — 옆 칸의 카드 그대로)와 **로그**(엔진 상태 한 줄 ·
 * 기동/끄기 · 콘솔을 칸 높이 전부로, `EngineLogPane`). 로그 칸은 예전 엔진 탭의 자리다(U2 에서 탭을 걷었다).
 * «DB» 칸은 따로 두지 않는다: 지금 국면의 DB 값 · 주석은 국면 카드가, 자식 값은 판의 칩이 이미 말한다(같은
 * 것을 두 곳에 그리지 않는다).
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
  const pane = useInspectorPane((s) => s.pane);
  return (
    <aside id={id} className="inspector" role="tabpanel" aria-label={label}>
      <PaneTabs className="inspector__seg" />
      {pane === "log" ? (
        <div className="inspector__log">
          <EngineLogPane />
        </div>
      ) : (
        <div className="inspector__body boardscreen__side">{children}</div>
      )}
    </aside>
  );
}
