import { describe, it, expect } from "vitest";
import { ALL_RAMPS } from "./ramps";
import { rampIsMonotone, contrastRatio, toHex, mixColors, srgbToLinear } from "./oklch";
import {
  LightScheme,
  DarkScheme,
  AmoledScheme,
  AMOLED_KEYS,
  WoodLight,
  WoodDark,
  CONTRAST_PAIRS,
  type TokenValue,
} from "./scheme";
import type { Rgb } from "./oklch";
import { CHROME_ALPHA, DESKTOP, LAYOUT, RHYTHM, RHYTHM_DESKTOP } from "./tokens";
import golden from "./tokens.golden.json";

/**
 * 앱의 팔레트 시험이 지키던 성질 + **앱이 실제로 내는 값과의 대조**.
 *
 * 기준값 `tokens.golden.json` 은 `tools/tone-dump/ToneDump.java` 가 낸 것이다
 * (Oklch.kt 를 Java 로 전사 — Kotlin Float = Java float, kotlin.math = java.lang.Math).
 * 전사가 맞다는 근거는 `Color.kt` 가 못 박아 둔 `Clay.tone(76) = #DAB673` 을 그 덤프가
 * **정확히 재현**한다는 것이다.
 *
 * W1 에서는 이 대조가 ±1 을 허용했는데, 이제 **정확히 같아야 한다.**
 * 어긋나던 이유가 Float/double 차이가 아니라 반올림 규칙을 잘못 옮긴 것이었기 때문이다
 * (`oklch.ts` 의 `toHex` 주석, `docs/engineering-notes.md` §7).
 */
describe("Kotlin 덤프와 정확 대조 (14램프 × 톤 101)", () => {
  const ramps = golden.ramps as Record<string, string[]>;

  it("덤프가 Color.kt 의 문서화된 앵커를 재현한다", () => {
    // 이 하나가 전사(轉寫)의 신뢰 근거다. 여기가 깨지면 덤프부터 의심해야 한다.
    expect(golden.anchors["Clay.tone(76)"]).toBe("#DAB673");
  });

  for (const [name, ramp] of Object.entries(ALL_RAMPS)) {
    it(`${name} — 톤 0..100 전부 일치`, () => {
      const want = ramps[name];
      expect(want, `덤프에 ${name} 이 없다`).toBeDefined();
      const mismatches: string[] = [];
      for (let t = 0; t <= 100; t++) {
        const got = ramp.hex(t);
        if (got !== want![t]) mismatches.push(`tone ${t}: ${got} ≠ ${want![t]}`);
      }
      expect(mismatches).toEqual([]);
    });
  }
});

describe("Clay 앵커 — Color.kt 주석의 두 값", () => {
  const clay = (golden.ramps as Record<string, string[]>)["Clay"]!;

  it("톤 76 = 데스크톱 보드의 나무색 #DAB673 — 주석과 일치", () => {
    expect(clay[76]).toBe("#DAB673");
  });

  it("톤 42 = #7E5D14 — 주석의 #7B5E22 는 틀렸다", () => {
    // Kotlin 이 실제로 내는 값이 #7E5D14 다(위 덤프). 주석은 낡았다.
    // 판정 근거와 처리는 docs/engineering-notes.md §7 에 적었고,
    // Zenyth 쪽 주석도 고쳤다.
    expect(clay[42]).toBe("#7E5D14");
  });
});

describe("램프 단조성", () => {
  // 위 수식이 편집되다가 램프가 조용히 납작해지는 것을 막는다.
  for (const [name, r] of Object.entries(ALL_RAMPS)) {
    it(`${name} 은 톤이 오르면 휘도도 오른다`, () => {
      expect(rampIsMonotone(r)).toBe(true);
    });
  }
});

const isBlack = (v: TokenValue): v is { black: number } => "black" in v;
const rgb = (s: Record<string, TokenValue>, k: string): Rgb => {
  const v = s[k];
  if (!v) throw new Error(`토큰 없음: ${k}`);
  if (isBlack(v)) return { r: 0, g: 0, b: 0 };
  return v;
};

const SCHEMES = [
  { name: "light", s: LightScheme },
  { name: "dark", s: DarkScheme },
  { name: "amoled", s: AmoledScheme },
  // 보드 화면의 나무색 팔레트 — 앱 WoodTheme. 검은 배경에서는 면을 검정으로 되돌린다(tokens.css 와 같은 순서).
  { name: "wood light", s: { ...LightScheme, ...WoodLight } },
  { name: "wood dark", s: { ...DarkScheme, ...WoodDark } },
  {
    name: "wood amoled",
    s: {
      ...AmoledScheme,
      ...WoodDark,
      ...Object.fromEntries(AMOLED_KEYS.map((k) => [k, AmoledScheme[k]!])),
    },
  },
] as const;

describe("대비", () => {
  for (const scheme of SCHEMES) {
    for (const [fg, bg] of CONTRAST_PAIRS) {
      it(`${scheme.name}: ${fg} / ${bg} 는 4.5:1 이상`, () => {
        const ratio = contrastRatio(rgb(scheme.s, fg), rgb(scheme.s, bg));
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe("스킴 완결성", () => {
  it("두 스킴이 같은 토큰 집합을 갖는다(다크 전용 chipRim 제외)", () => {
    const light = new Set(Object.keys(LightScheme));
    const dark = new Set(Object.keys(DarkScheme));
    const onlyDark = [...dark].filter((k) => !light.has(k));
    const onlyLight = [...light].filter((k) => !dark.has(k));
    // 다크 보드에서만 값 칩에 테두리가 필요하다 — 그 하나가 유일한 비대칭이다.
    expect(onlyDark).toEqual(["board-chip-rim"]);
    expect(onlyLight).toEqual([]);
  });
});

describe("선형광 혼합", () => {
  it("검정과 흰색의 중간은 sRGB 중간값(#808080)보다 밝다", () => {
    // 감마를 무시하고 섞으면 여기서 #808080 이 나온다. 그게 «정직하지 않은» 혼합이다.
    const mid = toHex(mixColors({ r: 0, g: 0, b: 0 }, { r: 1, g: 1, b: 1 }, 0.5));
    expect(mid).toBe("#BCBCBC"); // 선형 0.5 → sRGB 0.7354 → 187.5 → 반올림 188
  });
});

/** sRGB → OKLab(Ottosson). 앱 `Oklch.kt` 의 `oklchOf` 와 같은 행렬. */
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

describe("면과 강조 — 앱 ThemeContrastTest 의 성질 (Z1)", () => {
  for (const { name, s } of SCHEMES) {
    it(`${name}: 카드 면이 페이지와 1.06:1 이상 갈린다(테두리가 없으니 이것이 경계)`, () => {
      expect(
        contrastRatio(rgb(s, "surface-container"), rgb(s, "background")),
      ).toBeGreaterThanOrEqual(1.06);
    });

    it(`${name}: 강조색(primary)이 의미색에서 OKLab 0.08 이상 떨어진다(색은 값이다)`, () => {
      const p = oklab(rgb(s, "primary"));
      for (const meaning of ["result-black", "result-white", "error", "positive", "caution"]) {
        const q = oklab(rgb(s, meaning));
        const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        expect(d, `primary ↔ ${meaning}`).toBeGreaterThanOrEqual(0.08);
      }
    });
  }

  it("검은 배경은 페이지만 검정이고, 면만 바꾼다(강조 · 의미 · 판은 다크 그대로)", () => {
    expect(toHex(rgb(AmoledScheme, "background"))).toBe("#000000");
    expect(
      AMOLED_KEYS.every((k) => k === "background" || k === "surface" || k.startsWith("surface-")),
    ).toBe(true);
  });
});

describe("데스크톱 셸 — Mica 위 크롬과 밀도 (데스크톱 Z1)", () => {
  /** 브라우저의 알파 합성: `color-mix(in srgb, …)` 와 투명 크롬 위 합성은 둘 다 **감마 공간**에서 섞는다. */
  const overSrgb = (fg: Rgb, alpha: number, backdrop: Rgb): Rgb => ({
    r: fg.r * alpha + backdrop.r * (1 - alpha),
    g: fg.g * alpha + backdrop.g * (1 - alpha),
    b: fg.b * alpha + backdrop.b * (1 - alpha),
  });
  // Mica 는 배경화면을 흐려 비춘다 — 무엇이 비칠지 모르므로 두 극단을 다 견뎌야 한다.
  const BACKDROPS = [
    { name: "흰 배경화면", c: { r: 1, g: 1, b: 1 } },
    { name: "검은 배경화면", c: { r: 0, g: 0, b: 0 } },
  ];
  const CHROME_TEXT = ["on-surface", "on-surface-variant", "primary"] as const;
  const CHROME_SCHEMES = [
    { name: "light", s: LightScheme },
    { name: "dark", s: DarkScheme },
    { name: "amoled", s: AmoledScheme },
  ];

  for (const { name, s } of CHROME_SCHEMES) {
    for (const fg of CHROME_TEXT) {
      for (const bd of BACKDROPS) {
        it(`${name}: ${fg} 가 크롬(${CHROME_ALPHA}) 위에서 ${bd.name}이 비쳐도 4.5:1 이상`, () => {
          const chrome = overSrgb(rgb(s, "background"), CHROME_ALPHA, bd.c);
          expect(contrastRatio(rgb(s, fg), chrome)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }

  it("크롬은 실제로 비친다(불투명도 1 이면 Mica 를 쓸 이유가 없다)", () => {
    expect(CHROME_ALPHA).toBeLessThan(1);
  });

  it("밀도는 RHYTHM 의 열쇠만 덮어쓰고, 마우스 대상도 WCAG 2.5.8(24px) 아래로 가지 않는다", () => {
    for (const k of Object.keys(RHYTHM_DESKTOP)) expect(Object.keys(RHYTHM)).toContain(k);
    expect(RHYTHM_DESKTOP.minTouch).toBeGreaterThanOrEqual(24);
    // 데스크톱이 더 넓어질 이유는 없다 — 밀도는 줄이기만 한다.
    for (const [k, v] of Object.entries(RHYTHM_DESKTOP)) {
      expect(v, k).toBeLessThanOrEqual(RHYTHM[k as keyof typeof RHYTHM]);
    }
  });

  it("인스펙터 폭이 말이 되고, 옆에 붙는 폭에서 보드 칸이 남는다", () => {
    expect(DESKTOP.inspectorMin).toBeLessThanOrEqual(DESKTOP.inspectorMax);
    // 옆에 붙는 최소 창 폭에서: 펼친 레일 + 가장 넓은 인스펙터를 빼고도 읽기 폭(640)이 남아야 한다.
    expect(
      DESKTOP.inspectorBeside - DESKTOP.railExpanded - DESKTOP.inspectorMax,
    ).toBeGreaterThanOrEqual(LAYOUT.readingWidth);
  });
});
