import { describe, expect, it } from "vitest";
import { contrastRatio, srgbToLinear, type Rgb } from "./oklch";
import { AmoledScheme, DarkScheme, LightScheme, type Scheme } from "./scheme";
import {
  COVER_HUES,
  COVER_KEYS,
  PEARL,
  coverArt,
  coverTint,
  isMoon,
  type CoverKey,
} from "./covers";
import { COUNT, KOREAN } from "../opening/opening26";

/**
 * 커버 팔레트(라이브러리 계획 §6 «커버»)의 성질 — 모든 주형 × 라이트 · 다크 · 검은 배경에서 글자 AA, 돌과 테두리는
 * 그래픽 3:1(WCAG 1.4.11), 이웃 주형의 OKLab 거리 하한, 물든 강조(primary)와 의미색의 거리.
 */

const rgb = (s: Scheme, k: string): Rgb => {
  const v = s[k];
  if (!v || "black" in v) throw new Error(`no color ${k}`);
  return v;
};

function oklab(c: Rgb): [number, number, number] {
  const r = srgbToLinear(c.r);
  const g = srgbToLinear(c.g);
  const b = srgbToLinear(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
const dist = (a: Rgb, b: Rgb) => {
  const p = oklab(a);
  const q = oklab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

/** 물든 칸의 실제 색 — 바탕 스킴 위에 덮어쓰기(검은 배경은 면만 다시 검정). */
const THEMES: readonly { name: string; base: Scheme; dark: boolean; amoled?: boolean }[] = [
  { name: "라이트", base: LightScheme, dark: false },
  { name: "다크", base: DarkScheme, dark: true },
  { name: "검은 배경", base: AmoledScheme, dark: true, amoled: true },
];
function tinted(k: CoverKey, th: (typeof THEMES)[number]): Scheme {
  const s = { ...th.base, ...coverArt(k, th.dark), ...coverTint(k, th.dark) };
  if (th.amoled)
    for (const key of Object.keys(AmoledScheme))
      if (key.startsWith("surface") || key === "background") s[key] = AmoledScheme[key]!;
  return s;
}

describe("커버 색상각 표", () => {
  it("月 · 星 가르기가 opening26 의 이름과 같다", () => {
    for (let i = 0; i < COUNT; i++) expect(isMoon(i), KOREAN[i]).toBe(KOREAN[i]!.endsWith("월"));
  });

  it("26 색상각이 모두 다르고 月은 180 ~ 330, 星은 20 ~ 110 안이다", () => {
    expect(new Set(COVER_HUES).size).toBe(COUNT);
    COVER_HUES.forEach((h, i) => {
      const [lo, hi] = isMoon(i) ? [180, 330] : [20, 110];
      expect(h).toBeGreaterThanOrEqual(lo);
      expect(h).toBeLessThanOrEqual(hi);
    });
  });

  for (const dark of [false, true])
    it(`${dark ? "다크" : "라이트"}: 번호가 이웃한 주형의 그림 색이 OKLab 0.03 이상 떨어진다`, () => {
      for (let i = 0; i + 1 < COUNT; i++) {
        for (const k of ["cov-a", "cov-b"]) {
          const d = dist(rgb(coverArt(i, dark), k), rgb(coverArt(i + 1, dark), k));
          expect(d, `${KOREAN[i]} ↔ ${KOREAN[i + 1]} ${k}`).toBeGreaterThanOrEqual(0.03);
        }
      }
    });
});

describe("커버 그림 — 돌과 테두리", () => {
  for (const k of COVER_KEYS)
    for (const dark of [false, true]) {
      it(`${k} ${dark ? "다크" : "라이트"}: 테두리가 배경과 3:1, 흑돌 · 백돌 중 배경과 붙는 쪽도 테두리로 선다`, () => {
        const a = coverArt(k, dark);
        for (const bg of ["cov-a", "cov-b"]) {
          expect(contrastRatio(rgb(a, "cov-rim"), rgb(a, bg))).toBeGreaterThanOrEqual(3);
          // 라이트는 흑돌이, 다크는 백돌(진주)이 몸으로 선다.
          const body = dark ? PEARL : rgb(a, "cov-stone");
          expect(contrastRatio(body, rgb(a, bg))).toBeGreaterThanOrEqual(3);
        }
      });
    }
});

describe("물든 상세 — 글자 AA · 면 · 강조", () => {
  const PAIRS: readonly (readonly [string, string])[] = [
    ["on-surface", "cov-a"],
    ["on-surface", "cov-b"],
    ["on-surface-variant", "cov-a"],
    ["on-surface", "background"],
    ["on-surface", "surface-container"],
    ["on-surface-variant", "surface-container"],
    ["on-surface", "surface-container-high"],
    ["on-surface-variant", "surface-container-high"],
    ["on-primary", "primary"],
    ["on-secondary-container", "secondary-container"],
  ];
  for (const k of COVER_KEYS)
    for (const th of THEMES) {
      const s = tinted(k, th);
      it(`${k} ${th.name}: 글자 쌍 4.5:1`, () => {
        for (const [fg, bg] of PAIRS)
          expect(contrastRatio(rgb(s, fg), rgb(s, bg)), `${fg} / ${bg}`).toBeGreaterThanOrEqual(
            4.5,
          );
      });
      if (typeof k === "number") {
        it(`${k} ${th.name}: 카드 면이 페이지와 1.06:1 이상, 강조가 의미색과 OKLab 0.08 이상`, () => {
          expect(
            contrastRatio(rgb(s, "surface-container"), rgb(s, "background")),
          ).toBeGreaterThanOrEqual(1.06);
          for (const meaning of ["result-black", "result-white", "error", "positive", "caution"])
            expect(dist(rgb(s, "primary"), rgb(s, meaning)), meaning).toBeGreaterThanOrEqual(0.08);
        });
      }
    }
});
