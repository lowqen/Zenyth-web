import { useLocation, useNavigate } from "react-router-dom";
import { useEngineStore } from "../engine/engine-state";
import { useBoardStore } from "../features/board/boardStore";
import { useGameStore } from "../features/board/gameStore";
import { useDisplayedAnalysis } from "../features/board/currentAnalysis";
import { useStopAnalysis } from "../features/board/analysisActions";
import { useTimedRun } from "../features/board/runClock";
import { MiniBoard } from "../components/MiniBoard";
import { WavyProgress } from "../components/WavyProgress";
import { Icon } from "../components/icons";
import { ICON } from "../components/icon-paths";
import { label } from "../core/model/move";
import { t } from "../i18n/i18n";

/**
 * 미니 분석 바 — 앱 M5 의 «미니 플레이어»(결정 E4): 분석이나 대국 중 엔진의 생각이 돌고 있을 때, **다른
 * 화면에서** 하단 탭 위에 얇게. 미니 판 · 최선수 · 승률 · 깊이와 ⏸, 위 가장자리에 물결 진행선(시간이 정해진
 * 실행이면). 누르면 보드로 간다.
 *
 * 엔진이 백그라운드에서도 도는 앱이라, 보드를 떠나면 지금 무엇이 돌고 있는지가 보이지 않던 자리다. 보드의
 * 상태를 **읽기만** 하고 멈춤만 부탁한다 — 엔진 통신은 그대로다. 리뷰 · 증명(엔진의 주인이 따로 있다)은 연구
 * 화면의 일이라 여기 띄우지 않는다. 레일(넓은 화면)에는 없다 — 앱과 같다.
 */
export function MiniAnalysisBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const status = useEngineStore((s) => s.status);
  const owner = useEngineStore((s) => s.owner);
  const thinking = useGameStore((s) => s.thinking);
  const moveNow = useGameStore((s) => s.moveNow);
  const stones = useBoardStore((s) => s.render.stones);
  const size = useBoardStore((s) => s.render.size);
  const stopAnalysis = useStopAnalysis();
  const { snapshot } = useDisplayedAnalysis();
  const run = useTimedRun();

  if (pathname.startsWith("/board") || status !== "searching" || owner) return null;
  const { stats, bestMove } = snapshot;
  const detail = [
    stats.winRatePct === null ? null : t("승률 {n}%", { n: stats.winRatePct }),
    stats.depth ? t("깊이 {n}", { n: stats.depth }) : null,
    t("{n}수", { n: stones.length }),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="minibar" role="region" aria-label={t("진행 중인 분석")}>
      {run && (
        <WavyProgress
          className="minibar__wave"
          startedAt={run.startedAt}
          durationMs={run.durationMs}
        />
      )}
      <button type="button" className="minibar__open" onClick={() => navigate("/board")}>
        <MiniBoard moves={stones} size={size} className="minibar__board" />
        <span className="minibar__text">
          <strong className="tnum">
            {thinking ? t("엔진이 생각 중") : bestMove ? label(bestMove, size) : t("읽는 중")}
          </strong>
          <span className="tnum">{detail}</span>
        </span>
      </button>
      <button
        type="button"
        className="minibar__pause"
        aria-label={thinking ? t("지금 두기") : t("엔진 멈춤")}
        title={thinking ? t("지금 두기") : t("엔진 멈춤")}
        onClick={thinking ? moveNow : stopAnalysis}
      >
        <Icon d={ICON.pause} />
      </button>
    </div>
  );
}
