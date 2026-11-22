/**
 * 라이브러리 커버의 색 — 26주형 × 한 색상각, 그리고 «일식» 둘(라이브러리 계획 §6 «커버»).
 *
 * - **月(16) = 청록 ~ 보라(180° ~ 330°, 밤하늘), 星(10) = 산호 ~ 금빛(20° ~ 110°, 별빛).** 이름 끝 글자(월 · 성)가 가른다.
 * - 색상각은 10° 칸에 하나씩, 주형 번호 순서로 칸을 **건너뛰며**(月 5칸 · 星 3칸) 놓는다 — 번호가 이웃한 주형
 *   (한성 · 계월 · 소성 …)이 이웃한 색이 되지 않게. 시험(`covers.test.ts`)이 이웃 주형의 OKLab 거리 하한을 본다.
 * - 표는 여기 하나다. 값을 바꾸면 `pnpm gen:tokens` 로 `tokens.css` 의 `[data-cov]` 블록을 다시 굽는다.
 *
 * 토큰은 둘로 나뉜다.
 * - **그림**(`--cov-a` · `--cov-b` · `--cov-stone` · `--cov-rim` · `--cov-line`): `DbCover` SVG 가 쓴다. 배경 그라데이션은
 *   컨테이너 톤(라이트 90 → 80, 다크 30 → 20), 흑돌은 그 색 톤 10, 백돌은 진주(`PEARL`), 테두리는 배경과 3:1 이상.
 * - **물들이기**(Material 역할 덮어쓰기): 상세 화면이 커버 색으로 물든다(`[data-wood]` 와 같은 방식 — 그 칸 안에서만).
 *   «일식»은 물들이지 않는다(보라 그대로).
 */
import { ramp, type Rgb } from "./oklch";
import type { Scheme } from "./scheme";
import { Violet } from "./ramps";

/** 커버 하나의 열쇠 — 주형 번호(0..25) 또는 «일식» 무늬 둘. CSS `[data-cov]` 값과 같다. */
export type CoverKey = number | "e0" | "e1";

const COUNT = 26;
/**
 * 星(이름이 «성»으로 끝나는) 주형 — `opening26.KOREAN` 에서 옮긴 것(시험이 대조한다). 여기서 그 모듈을 부르지 않는
 * 것은 토큰 생성기(node)가 i18n 까지 끌고 오지 않게 하려서다.
 */
const STARS: ReadonlySet<number> = new Set([0, 2, 6, 10, 12, 13, 15, 17, 22, 25]);

export const isMoon = (i: number) => !STARS.has(i);

/** 그림의 채도 — 배경 · 돌이 같은 램프. */
export const COVER_CHROMA = 0.07;
const MOON_FROM = 180;
const STAR_FROM = 20;
const MOON_STRIDE = 5;
const STAR_STRIDE = 3;

/** 26 색상각 — 주형 번호 순. */
export const COVER_HUES: readonly number[] = (() => {
  const hues = new Array<number>(COUNT).fill(0);
  let moon = 0;
  let star = 0;
  for (let i = 0; i < COUNT; i++) {
    if (isMoon(i)) hues[i] = MOON_FROM + ((moon++ * MOON_STRIDE) % 16) * 10;
    else hues[i] = STAR_FROM + ((star++ * STAR_STRIDE) % 10) * 10;
  }
  return hues;
})();

/** 백돌 — 진주. 테마와 무관. */
export const PEARL: Rgb = { r: 0xf6 / 255, g: 0xf1 / 255, b: 0xe9 / 255 };

/** «일식»의 두 램프 — 보라(강조색 색상각)와 그보다 옅은 안개. */
const ECLIPSE = { e0: ramp(Violet.hue, COVER_CHROMA), e1: ramp(Violet.hue, 0.025) } as const;

const artRamp = (k: CoverKey) =>
  typeof k === "number" ? ramp(COVER_HUES[k]!, COVER_CHROMA) : ECLIPSE[k];

/** 그림 토큰 — `DbCover` 가 쓴다. */
export function coverArt(k: CoverKey, dark: boolean): Scheme {
  const r = artRamp(k);
  return dark
    ? {
        "cov-a": r.tone(30),
        "cov-b": r.tone(20),
        "cov-stone": r.tone(10),
        "cov-rim": r.tone(72),
        "cov-line": r.tone(48),
      }
    : {
        "cov-a": r.tone(90),
        "cov-b": r.tone(80),
        "cov-stone": r.tone(10),
        "cov-rim": r.tone(30),
        "cov-line": r.tone(58),
      };
}

/**
 * 물들이기 — `woodScheme` 과 같은 뼈대(종이 · 잉크 · 연한 색). 강조(primary)는 잉크라 채도가 낮다 — 의미색과
 * 붙지 않는다(색은 값이다). «일식»은 빈 표(보라 그대로).
 */
export function coverTint(k: CoverKey, dark: boolean): Scheme {
  if (typeof k !== "number") return {};
  const h = COVER_HUES[k]!;
  const paper = ramp(h, dark ? 0.012 : 0.014);
  const ink = ramp(h, 0.018);
  const pale = ramp(h, 0.035);
  return dark
    ? {
        primary: paper.tone(92),
        "on-primary": ink.tone(12),
        "secondary-container": pale.tone(28),
        "on-secondary-container": paper.tone(92),
        "on-surface-variant": ink.tone(78),
        "outline-variant": paper.tone(32),
        background: paper.tone(10),
        surface: paper.tone(10),
        "surface-container": paper.tone(18),
        "surface-container-high": paper.tone(22),
        "surface-container-highest": paper.tone(26),
      }
    : {
        primary: ink.tone(22),
        "on-primary": paper.tone(99),
        "secondary-container": pale.tone(89),
        "on-secondary-container": ink.tone(24),
        "on-surface-variant": ink.tone(38),
        "outline-variant": paper.tone(84),
        background: paper.tone(98),
        surface: paper.tone(98),
        "surface-container": paper.tone(94),
        "surface-container-high": paper.tone(91),
        "surface-container-highest": paper.tone(89),
      };
}

/** 굽는 순서 — 26주형, 그다음 «일식» 둘. */
export const COVER_KEYS: readonly CoverKey[] = [
  ...Array.from({ length: COUNT }, (_, i) => i),
  "e0",
  "e1",
];
