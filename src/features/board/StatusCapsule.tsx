import { useBoardStore } from "./boardStore";
import { useGameStore } from "./gameStore";
import { useEngineStore } from "../../engine/engine-state";
import { useDisplayedAnalysis } from "./currentAnalysis";
import { STATUS_TEXT } from "./analysisActions";
import { compact, formatEval } from "./statFormat";
import { COMPUTER_SIDE_LABEL, describeResult } from "../../core/model/game";
import { label } from "../../core/model/move";
import { t } from "../../i18n/i18n";

/**
 * 판 밑에 떠 있는 상태 캡슐 — 데스크톱 Z5(계획 §4 · Mornye 의 떠 있는 플레이어 캡슐).
 *
 * 웹 보드의 요약 줄(`SummaryLine`)이 하던 말을 한 줄 알약에 담는다. 넓은 창에서는 판을 보는 눈이 오른쪽 칸까지
 * 가지 않고 판 바로 밑에서 최선수 · 승률 · 깊이를 읽는다.
 *
 * - **분석**: 상태 점 · 최선수(굵게) · 승률 · 평가 · 깊이 · 속도. 칸이 좁으면 뒤쪽 값부터 통째로 감춘다(base.css).
 * - **대국**: 상태 점 · 결과 아니면 누구 차례 · 대진 · 수.
 *
 * 실시간 값은 **보간하지 않는다**(Zenyth 움직임 규약) — 엔진이 말한 값을 그대로 쓴다. 직전 국면의 값이어도
 * 흐리게 하지 않는다(웹 요약 줄과 같다) — 어느 국면의 것인지는 인스펙터의 엔진 카드가 글로 말한다.
 *
 * 최선수 글자는 웹 요약 줄과 같은 `data-k="summary-best"` — 스모크가 배치에 상관없이 같은 자리를 집는다.
 */
export function StatusCapsule() {
  const game = useGameStore((s) => s.mode === "game");
  return (
    <div className="capsule" role="status" aria-live="off" data-k="summary">
      {game ? <GameStatus /> : <AnalysisStatus />}
    </div>
  );
}

function AnalysisStatus() {
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
      <p className="capsule__line">
        <span className="summary__dot" data-status={status} aria-hidden="true" />
        <span className="capsule__hint">
          {status === "error" ? STATUS_TEXT[status] : t("▶ 로 분석 시작")}
        </span>
      </p>
    );
  }
  return (
    <p className="capsule__line tnum">
      <span className="summary__dot" data-status={status} aria-hidden="true" />
      <span className="capsule__best" data-k="summary-best" aria-label={t("최선수")}>
        {bestMove ? label(bestMove, size) : t("없음")}
      </span>
      {stats.winRatePct !== null && (
        <span className="capsule__val" title={t("승률")}>
          {stats.winRatePct}%
        </span>
      )}
      <span className="capsule__val" title={t("평가")}>
        {formatEval(stats)}
      </span>
      {stats.depth > 0 && (
        <span className="capsule__val" title={t("깊이")}>
          d{stats.depth}
          {stats.selDepth ? `/${stats.selDepth}` : ""}
        </span>
      )}
      {stats.speed !== null && (
        <span className="capsule__val" title={t("속도")}>
          {compact(stats.speed)}/s
        </span>
      )}
    </p>
  );
}

function GameStatus() {
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
    <p className="capsule__line tnum">
      <span
        className="summary__dot"
        data-status={thinking ? "searching" : status}
        aria-hidden="true"
      />
      <span className="capsule__best capsule__best--text">{headline}</span>
      <span className="capsule__val">{COMPUTER_SIDE_LABEL[side]}</span>
      <span className="capsule__val">{t("{n}수", { n: count })}</span>
      {!live && <span className="capsule__val">{STATUS_TEXT[status]}</span>}
    </p>
  );
}
