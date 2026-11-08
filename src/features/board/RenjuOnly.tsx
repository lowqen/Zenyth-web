import type { ReactNode } from "react";
import { useGameStore } from "./gameStore";
import { researchBlockedBy } from "../../core/model/rules";
import { t } from "../../i18n/i18n";

/**
 * 렌주 전제 도구(리뷰 · 증명 · 오프닝 · 수순 · 랭킹 · 정석)의 문 — 규칙이 렌주가 아니면 내용 대신 까닭과
 * 「렌주로 바꾸기」를 보인다(데스크톱 Z4, 2026-11-08 결정: 프리스타일 · 스탠다드는 대국 · 분석만).
 * 바꾸면 새 대국이다 — 버튼 글이 그것을 말한다.
 */
export function RenjuOnly({ children }: { children: ReactNode }) {
  const rule = useGameStore((s) => s.rule);
  const setRule = useGameStore((s) => s.setRule);
  const why = researchBlockedBy(rule);
  if (!why) return <>{children}</>;
  return (
    <section className="card stack" data-k="renju-only">
      <p>{why}</p>
      <div>
        <button type="button" className="button--primary" onClick={() => setRule("renju")}>
          {t("렌주로 바꾸고 새 대국")}
        </button>
      </div>
    </section>
  );
}
