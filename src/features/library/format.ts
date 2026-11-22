import { getLang, t } from "../../i18n/i18n";

/** 국면 수 — 한국어는 «81만», 영어는 «810K». */
export function fmtCount(n: number): string {
  if (getLang() === "ko") {
    if (n >= 1e8) return `${trim(n / 1e8)}억`;
    if (n >= 1e4) return `${trim(n / 1e4)}만`;
    return n.toLocaleString("ko-KR");
  }
  if (n >= 1e6) return `${trim(n / 1e6)}M`;
  if (n >= 1e4) return `${trim(n / 1e3)}K`;
  return n.toLocaleString("en-US");
}

/** 10 아래는 소수 한 자리, 그 위는 정수. */
const trim = (v: number) =>
  v < 10 ? (Math.floor(v * 10) / 10).toString() : Math.floor(v).toString();

export function fmtBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)}GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n >= 100 * 1024 * 1024 ? 0 : 1)}MB`;
  return `${Math.max(1, Math.round(n / 1024))}KB`;
}

/** «12만 국면». */
export const positionsText = (n: number) => t("{n} 국면", { n: fmtCount(n) });

/** 통계 열쇠(`renju-15`, `freestyle-20` …) → «렌주 15». */
export function ruleLabel(key: string): string {
  const m = /^([a-z]+\d*)-(\d+(?:x\d+)?)$/.exec(key);
  if (!m) return key;
  const name =
    m[1] === "renju"
      ? t("렌주")
      : m[1] === "standard"
        ? t("표준")
        : m[1] === "freestyle"
          ? t("자유")
          : m[1]!;
  return `${name} ${m[2]}`;
}

/** 가장 많은 규칙 · 판(섞였으면 «외 n»). */
export function mainRule(rules: Record<string, number> | undefined): string | null {
  if (!rules) return null;
  const keys = Object.entries(rules).sort((a, b) => b[1] - a[1]);
  if (!keys.length) return null;
  const first = ruleLabel(keys[0]![0]);
  return keys.length > 1 ? t("{rule} 외 {n}", { rule: first, n: keys.length - 1 }) : first;
}

export const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString(getLang() === "ko" ? "ko-KR" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
