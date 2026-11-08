import type { SearchStats } from "../../engine/engine-types";
import { t } from "../../i18n/i18n";

/** 분석 수치의 글자꼴 — 엔진 카드(`AnalysisPanel`)와 상태 캡슐(`StatusCapsule`, 데스크톱 Z5)이 같이 쓴다. */

const NONE = () => t("없음");

export function formatEval(stats: Pick<SearchStats, "evalCp" | "mate">): string {
  if (stats.mate !== null && stats.mate !== 0) {
    return stats.mate > 0 ? `+M${stats.mate}` : `-M${-stats.mate}`;
  }
  return stats.evalCp === null ? NONE() : String(stats.evalCp);
}

/** 노드·속도는 자릿수만 읽히면 된다 — 1,234,567 보다 1.23M 이 흘깃 읽힌다. */
export function compact(n: number | null): string {
  if (n === null) return NONE();
  if (n < 1e3) return String(n);
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}K`;
  if (n < 1e9) return `${(n / 1e6).toFixed(n < 1e7 ? 2 : 1)}M`;
  return `${(n / 1e9).toFixed(2)}G`;
}
