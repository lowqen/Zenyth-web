import { useBoardStore } from "./boardStore";
import { useGameStore } from "./gameStore";
import { useEngineStore } from "../../engine/engine-state";
import { useDisplayedAnalysis } from "./currentAnalysis";
import { STATUS_TEXT } from "./analysisActions";
import { COMPUTER_SIDE_LABEL, describeResult } from "../../core/model/game";
import { label } from "../../core/model/move";
import { t } from "../../i18n/i18n";

/**
 * 판 아래의 요약 줄 — 앱 `SummaryStrip`(UI 개편 P3 · M5, 2026-11-01 보정).
 *
 * 판을 읽는 사람이 아무것도 끌어올리지 않고 원하는 것 하나:
 *
 * - **분석 탭**: 최선수를 크게, 혼자(32 Bold, 가운데). 승률 · 평가 · 깊이는 엔진 카드의 큰 타일이 말하고
 *   (앱도 2026-11-01 알약을 걷어 카드로 옮겼다 — 12sp 알약은 아무도 못 읽었다), 판은 최선수 자리에 승률을
 *   쓴다. 직전 국면의 값이어도 흐리게 하지 않는다 — 어느 국면의 것인지는 카드의 글이 말한다. 아직 읽은 것이
 *   없으면 ▶ 가 무엇을 하는지 한 줄.
 * - **대국 탭**: 결과, 아니면 누구 차례인지를 크게, 그 아래 알약 하나(대진 · 수 · 엔진이 살아 있지 않으면 그 상태).
 *
 * 최선수 글자는 `data-k="summary-best"` — 엔진 · 대국 스모크가 여기서 읽는다(예전 카드의 마지막 `dd`).
 */
export function SummaryLine() {
  const game = useGameStore((s) => s.mode === "game");
  return (
    <div className="summary" role="status" aria-live="off" data-k="summary">
      {game ? <GameSummary /> : <AnalysisSummary />}
    </div>
  );
}

function AnalysisSummary() {
  const status = useEngineStore((s) => s.status);
  const size = useBoardStore((s) => s.render.size);
  const { snapshot, stale } = useDisplayedAnalysis();
  const { stats, pvs, bestMove } = snapshot;
  const searching = status === "searching";
  const blank =
    !searching &&
    !stale &&
    !bestMove &&
    pvs.length === 0 &&
    !stats.depth &&
    stats.evalCp === null &&
    !stats.mate &&
    stats.winRatePct === null;

  if (blank) {
    return (
      <p className="summary__hint">
        <span className="summary__dot" data-status={status} aria-hidden="true" />
        {status === "error" ? STATUS_TEXT[status] : t("▶ 를 누르면 엔진이 최선수를 찾습니다")}
      </p>
    );
  }
  return (
    <p className="summary__best tnum" data-k="summary-best" aria-label={t("최선수")}>
      {bestMove ? label(bestMove, size) : t("없음")}
    </p>
  );
}

function GameSummary() {
  const count = useBoardStore((s) => s.render.stones.length);
  const result = useGameStore((s) => s.result);
  const thinking = useGameStore((s) => s.thinking);
  const side = useGameStore((s) => s.computerSide);
  const status = useEngineStore((s) => s.status);
  const live = status === "ready" || status === "searching";
  const turn = count % 2 === 0 ? t("흑") : t("백");
  const headline = result
    ? describeResult(result)
    : thinking
      ? t("엔진이 생각 중")
      : t("{side} 차례", { side: turn });
  return (
    <div className="summary__game">
      <p className="summary__state">
        <span
          className="summary__dot"
          data-status={thinking ? "searching" : status}
          aria-hidden="true"
        />
        {headline}
      </p>
      <span className="summary__pill tnum">
        {COMPUTER_SIDE_LABEL[side]} · {t("{n}수", { n: count })}
        {!live && ` · ${STATUS_TEXT[status]}`}
      </span>
    </div>
  );
}
