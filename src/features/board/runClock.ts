import { create } from "zustand";
import { useEngineStore } from "../../engine/engine-state";
import { useGameStore } from "./gameStore";

/**
 * 엔진이 지금 도는 «한 번의 실행»이 언제 시작됐나 — 물결 진행선(`WavyProgress`)이 읽는다.
 *
 * 엔진 상태가 탐색으로 바뀌는 순간을 여기 한 곳에서 적는다. 화면이 렌더 중에 시계를 읽지 않게(그리기 중의
 * `performance.now()` 는 순수하지 않다) — 모듈이 엔진 스토어를 구독한다.
 */
export const useRunClock = create<{ startedAt: number | null }>(() => ({ startedAt: null }));

useEngineStore.subscribe((s, prev) => {
  if (s.status === "searching" && prev.status !== "searching")
    useRunClock.setState({ startedAt: performance.now() });
  else if (s.status !== "searching" && prev.status === "searching")
    useRunClock.setState({ startedAt: null });
});

/**
 * 시간이 정해진 실행이면 그 길이(ms) — 앱 `timedRun()`: 분석은 «분석 시간»이 정해져 있을 때, 대국은 시간 제어가
 * 있는 엔진 착수(한 수 예산). 리뷰 · 증명의 탐색(엔진의 주인이 따로 있다)은 여기서 그리지 않는다. 무제한이면 null.
 */
export function useTimedRun(): { startedAt: number; durationMs: number } | null {
  const startedAt = useRunClock((s) => s.startedAt);
  const owner = useEngineStore((s) => s.owner);
  const analysisMs = useEngineStore((s) => s.analysisMs);
  const thinking = useGameStore((s) => s.thinking);
  const moveTimeMs = useGameStore((s) => s.moveTimeMs);
  if (startedAt === null || owner) return null;
  const durationMs = thinking ? (moveTimeMs > 0 ? moveTimeMs : Infinity) : analysisMs;
  return Number.isFinite(durationMs) ? { startedAt, durationMs } : null;
}
