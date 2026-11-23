import { t } from "../../i18n/i18n";
import { useLibraryStore } from "./libraryStore";

/** 작업 단계의 이름 — 워커가 보내는 `phase`. */
function phaseText(phase: string): string {
  switch (phase) {
    case "count":
      return t("세는 중");
    case "sort":
      return t("정렬하는 중");
    case "write":
      return t("쓰는 중");
    case "verify":
      return t("대조하는 중");
    default:
      return t("준비 중");
  }
}

/** 병합 · 분리 진행 줄 — 이름 붙은 막대 · 퍼센트 · [취소]. 작업이 없으면 그리지 않는다. */
export function JobProgress() {
  const job = useLibraryStore((s) => s.job);
  const cancel = useLibraryStore((s) => s.cancelJob);
  if (!job) return null;
  const pct = Math.round(job.fraction * 100);
  return (
    <div className="libjob" role="status" data-k="library-job">
      <span className="libjob__label">{phaseText(job.phase)}</span>
      <div className="lprogress">
        <div
          className="lprogress__bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={phaseText(job.phase)}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
        <span className="lprogress__value tnum">{pct}%</span>
        <button type="button" className="linkish" onClick={cancel}>
          {t("취소")}
        </button>
      </div>
    </div>
  );
}
