import { WavyProgress } from "../../components/WavyProgress";
import { useTimedRun } from "./runClock";

/**
 * 요약 줄과 카드 사이의 한 줄 — 앱 `BoardLayout` 의 10dp 줄: 시간이 정해진 실행 중이면 물결 진행선, 아니면
 * 머리카락 구분선.
 */
export function RunLine() {
  const run = useTimedRun();
  return (
    <div className="runline" data-k="runline">
      {run ? (
        <WavyProgress startedAt={run.startedAt} durationMs={run.durationMs} />
      ) : (
        <span className="runline__rule" />
      )}
    </div>
  );
}
