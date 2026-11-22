import type { CoverKey } from "../../core/design/covers";
import type { DbStats } from "../../core/database/yxdbindex";
import type { LibraryCover } from "../../data/library";

/** 항목의 커버 → 그릴 열쇠. 자동은 가장 많은 주형(분류된 국면이 없으면 «일식»). */
export function coverKeyOf(cover: LibraryCover, stats?: DbStats): CoverKey {
  if (
    cover.mode === "opening" &&
    cover.opening !== undefined &&
    cover.opening >= 0 &&
    cover.opening < 26
  )
    return cover.opening;
  if (cover.mode === "auto") {
    const top = dominantOpening(stats);
    if (top !== null) return top;
  }
  return cover.seed % 2 === 0 ? "e0" : "e1";
}

/** 가장 많은 주형(0..25) — 분류된 국면이 하나도 없으면 null. */
export function dominantOpening(stats?: DbStats): number | null {
  const o = stats?.openings;
  if (!o) return null;
  let best = -1;
  let n = 0;
  for (let i = 0; i < 26; i++) if ((o[i] ?? 0) > n) [best, n] = [i, o[i]!];
  return best >= 0 ? best : null;
}
