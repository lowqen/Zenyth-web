import type { EvalView } from "../../engine/eval-view";

/** 그래프의 한 점 — 기보의 `ply` 수째 국면에서 흑의 승률. */
export interface SeriesPoint {
  ply: number;
  pct: number;
}

/**
 * 형세 그래프가 그릴 점들 — 평가가 있는 국면만, 수 순서대로.
 *
 * **비어 있는 국면을 건너 이어 긋는다.** 처음에는 이웃한 수끼리만 이었는데, 대국에서는
 * 엔진이 **제 차례의 국면만** 읽으므로(사람 차례는 비어 있다) 점이 한 수 걸러 하나씩 서고,
 * 어느 구간도 두 점이 되지 않아 선이 한 줄도 그려지지 않았다 — 축만 남은 그래프였다.
 * 분석을 띄엄띄엄 돌린 기보도 같았다. 이제 아는 점끼리 잇고, 점이 드물면 점 표시(`markers`)를
 * 함께 그려 **어디가 실제로 읽은 국면인지** 보이게 한다.
 */
export function buildSeries(points: readonly (EvalView | null)[]): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  points.forEach((p, ply) => {
    if (p) out.push({ ply, pct: p.blackPct });
  });
  return out;
}

/** 점 표시를 그릴 만큼 드문가 — 많으면 점이 선을 덮어 오히려 읽히지 않는다. */
export const MARKER_LIMIT = 30;
export const showMarkers = (series: readonly SeriesPoint[]): boolean =>
  series.length > 0 && series.length <= MARKER_LIMIT;

/** `ply` 의 평가 — 없으면 그 앞에서 가장 가까운 평가(형세는 다음 평가까지 이어진다고 읽는다). */
export function evalAtOrBefore(
  points: readonly (EvalView | null)[],
  ply: number,
): { view: EvalView; ply: number } | null {
  for (let i = Math.min(ply, points.length - 1); i >= 0; i--) {
    const v = points[i];
    if (v) return { view: v, ply: i };
  }
  return null;
}

// ── 다시 그린 형세 그래프(앱 R3)의 셈 ────────────────────────────────────

/**
 * 이 수보다 멀리 떨어진 두 점 사이는 «읽지 않은 구간» — 곡선을 끊고 점선으로 잇는다(앱 R3). 2 까지는 이어 긋는다:
 * 대국에서는 엔진이 제 차례의 국면만 읽어 점이 한 수 걸러 선다 — 그것까지 점선이면 그래프 전체가 점선이다.
 */
export const GAP_PLIES = 2;

/** 이어 그을 구간들(곡선)과 그 사이의 빈 구간들(점선). */
export function splitRuns(series: readonly SeriesPoint[]): {
  runs: SeriesPoint[][];
  gaps: [SeriesPoint, SeriesPoint][];
} {
  const runs: SeriesPoint[][] = [];
  const gaps: [SeriesPoint, SeriesPoint][] = [];
  for (const p of series) {
    const run = runs.at(-1);
    const prev = run?.at(-1);
    if (run && prev && p.ply - prev.ply <= GAP_PLIES) run.push(p);
    else {
      if (prev) gaps.push([prev, p]);
      runs.push([p]);
    }
  }
  return { runs, gaps };
}

/**
 * 단조 3차 곡선(Fritsch–Carlson)의 SVG 경로 — 점을 지나되 **값을 넘어 출렁이지 않는다**(앱 `EvalGraph`).
 * 일반 3차 스플라인은 급한 역전 앞뒤로 100% 를 넘거나 50% 를 거꾸로 건너는 혹을 만든다 — 그것은 없는 형세다.
 */
export function monotonePath(pts: readonly { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return "";
  const f = (v: number) => v.toFixed(1);
  if (n === 1) return `M${f(pts[0]!.x)},${f(pts[0]!.y)}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1]!.x - pts[i]!.x);
    m.push((pts[i + 1]!.y - pts[i]!.y) / (dx[i] || 1));
  }
  const tan: number[] = [m[0]!];
  for (let i = 1; i < n - 1; i++) {
    tan.push(m[i - 1]! * m[i]! <= 0 ? 0 : (m[i - 1]! + m[i]!) / 2);
  }
  tan.push(m[n - 2]!);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      tan[i] = 0;
      tan[i + 1] = 0;
      continue;
    }
    const a = tan[i]! / m[i]!;
    const b = tan[i + 1]! / m[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      tan[i] = k * a * m[i]!;
      tan[i + 1] = k * b * m[i]!;
    }
  }
  let d = `M${f(pts[0]!.x)},${f(pts[0]!.y)}`;
  for (let i = 0; i < n - 1; i++) {
    const p = pts[i]!;
    const q = pts[i + 1]!;
    const h = dx[i]! / 3;
    d += `C${f(p.x + h)},${f(p.y + tan[i]! * h)} ${f(q.x - h)},${f(q.y - tan[i + 1]! * h)} ${f(q.x)},${f(q.y)}`;
  }
  return d;
}

/** 한 수에 이만큼(%p) 넘게 움직인 곳 — 형세가 기운 자리라 점을 찍는다(앱 R3, 금색). */
export const SWING_PCT = 15;

/** 직전에 읽은 점보다 `SWING_PCT` 넘게 움직인 점들. */
export function swings(series: readonly SeriesPoint[]): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (let i = 1; i < series.length; i++) {
    if (Math.abs(series[i]!.pct - series[i - 1]!.pct) >= SWING_PCT) out.push(series[i]!);
  }
  return out;
}

/** 수 번호 눈금 간격 — 30수까지 5, 90수까지 10, 그 뒤 20(앱 R3). */
export function tickStep(n: number): number {
  return n <= 30 ? 5 : n <= 90 ? 10 : 20;
}

/**
 * `ply` 에서 보이는 값이 그 앞에서 읽은 값보다 얼마나 바뀌었나(흑 기준 %p) — 머리의 변화 알약(«+8%p»).
 * 비교할 앞 점이 없으면 null.
 */
export function changeAt(points: readonly (EvalView | null)[], ply: number): number | null {
  const now = evalAtOrBefore(points, ply);
  if (!now) return null;
  const before = evalAtOrBefore(points, now.ply - 1);
  if (!before) return null;
  return Math.round(now.view.blackPct) - Math.round(before.view.blackPct);
}
