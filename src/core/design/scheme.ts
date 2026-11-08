/**
 * 역할 → 램프·톤 표. `Theme.kt`(ColorScheme 30역할) + `Color.kt`(RapfiColors) +
 * `BoardSkin.kt` 을 한 자리에 모은 것이다.
 *
 * **모든 역할을 채운다.** Material 은 빠진 역할을 자기 기본값(보라)으로 메우므로,
 * 서른 역할 중 열한 개만 이름 붙인 스킴은 팔레트가 둘인 앱이 된다 — 누군가
 * 생각한 부분은 이 앱의 색이고 나머지(카드 전부, 내비게이션 바, 구분선, 큰
 * 분석 버튼)는 보라. 웹에는 Material 런타임이 없지만 **표를 채운다는 규율은
 * 같은 이유로 유지한다**: 컴포넌트가 토큰을 찾다가 없으면 그 자리에서 색을
 * 발명하게 된다.
 */
import { ramp, type Rgb } from "./oklch";
import {
  Ink,
  Neutral,
  NeutralVariant,
  Sage,
  Clay,
  Maple,
  Violet,
  Lilac,
  Mist,
  MistVariant,
  WoodNight,
  Signal,
  ResultBlue,
  ResultGreen,
} from "./ramps";

/** 토큰 하나: 램프의 톤이거나, 알파가 있는 순수 검정(보드 그림자·후광뿐). */
export type TokenValue = Rgb | { black: number };

export interface Scheme {
  [token: string]: TokenValue;
}

/** Material 30역할 + 이 앱의 것 + 보드 스킨. 이름은 kebab-case 로 CSS 에 나간다. */
function scheme(dark: boolean): Scheme {
  const t = <T extends { tone(n: number): Rgb }>(r: T, light: number, night: number) =>
    r.tone(dark ? night : light);

  return {
    // ── Material 역할 ────────────────────────────────────────────────
    // 앱 `Theme.kt` 의 lightColors / darkColors 그대로(UI 개편 2차 M1 · 강조색 요청, 2026-10-29).
    // 페이지는 거의 흰색(Mist 99), 카드 · 그룹 행의 면(surface-container)은 한 톤 **어둡게**(95) —
    // 테두리 없이 면의 차이로 구획한다. 다크는 같은 관계를 거꾸로(페이지 10, 면 18).
    // 강조는 Violet(진한 톤 — 채운 버튼 · 스위치)과 Lilac(연한 톤 — 선택 칩 · 알약) 하나뿐이고,
    // 초록(Sage)은 크롬에서 빠져 의미(판의 마지막 수 · 후보 · 「연결됨」 positive)로만 남는다.
    primary: t(Violet, 40, 80),
    "on-primary": dark ? Violet.tone(20) : Mist.tone(100),
    "primary-container": t(Violet, 90, 30),
    "on-primary-container": t(Violet, 20, 92),
    "inverse-primary": t(Violet, 80, 40),

    secondary: t(Lilac, 40, 80),
    "on-secondary": dark ? Lilac.tone(20) : Mist.tone(100),
    "secondary-container": t(Lilac, 90, 30),
    "on-secondary-container": t(Lilac, 20, 92),

    tertiary: t(Clay, 38, 80),
    "on-tertiary": dark ? Clay.tone(18) : Mist.tone(100),
    "tertiary-container": t(Clay, 90, 28),
    "on-tertiary-container": t(Clay, 20, 92),

    error: t(Signal, 42, 78),
    "on-error": dark ? Signal.tone(16) : Mist.tone(100),
    "error-container": t(Signal, 92, 28),
    "on-error-container": t(Signal, 20, 92),

    background: t(Mist, 99, 10),
    "on-background": t(Mist, 10, 92),
    surface: t(Mist, 99, 10),
    "on-surface": t(Mist, 10, 92),
    "surface-variant": t(MistVariant, 90, 26),
    "on-surface-variant": t(MistVariant, 30, 80),
    "surface-tint": t(Violet, 40, 80),
    "inverse-surface": t(Mist, 20, 90),
    "inverse-on-surface": t(Mist, 95, 20),

    outline: t(MistVariant, 50, 60),
    "outline-variant": t(MistVariant, 82, 30),
    scrim: { black: 1 },

    "surface-bright": t(Mist, 99, 26),
    "surface-dim": t(Mist, 88, 8),
    "surface-container-lowest": t(Mist, 100, 7),
    "surface-container-low": t(Mist, 96, 14),
    "surface-container": t(Mist, 95, 18),
    "surface-container-high": t(Mist, 92, 22),
    "surface-container-highest": t(Mist, 90, 26),

    // ── Material 이 이름을 갖지 않은 것 (RapfiColors) ──────────────────
    "result-black": t(ResultBlue, 45, 76),
    "result-white": t(ResultGreen, 40, 74),
    "result-draw": t(NeutralVariant, 43, 74),
    "on-result": t(Neutral, 100, 10),
    positive: t(Sage, 38, 78),
    caution: t(Clay, 40, 76),

    // ── 보드 스킨 (BoardSkin.kt) ─────────────────────────────────────
    // 낮의 판은 메이플(Maple, 앱 2026-10-29 — 금색 Clay 82° 는 탁한 올리브로 읽혔다). 밝기(톤 76)는
    // 그대로라 값 칩 · 흰 돌 대비가 바뀌지 않는다. 다크 모드는 나무 자체가 다르다(Maple → WoodNight):
    // 톤 변화가 아니라 **재료** 변화다. 낮의 채도는 어두운 명도에서 나무가 아니라 주황 플라스틱으로 읽힌다.
    "board-wood": dark ? WoodNight.tone(33) : Maple.tone(76),
    "board-wood-edge": dark ? WoodNight.tone(26) : Maple.tone(70),
    "board-line": dark ? WoodNight.tone(52) : Maple.tone(40),
    "board-label": dark ? WoodNight.tone(70) : Maple.tone(30),
    "board-black-high": t(Ink, 28, 26),
    "board-black-low": t(Ink, 6, 4),
    "board-black-rim": t(Ink, 2, 1),
    "board-white-high": t(Neutral, 99, 96),
    "board-white-low": t(NeutralVariant, 84, 78),
    "board-white-rim": t(NeutralVariant, 58, 48),
    "board-stone-shadow": { black: dark ? 0x59 / 255 : 0x40 / 255 },
    "board-last-move": t(Sage, 48, 72),
    "board-best": t(Clay, 90, 88),
    "board-best-halo": { black: dark ? 0x73 / 255 : 0x66 / 255 },
    "board-candidate": t(Sage, 42, 68),
    "board-forbid": t(Signal, 48, 66),
    "board-blocked": dark ? Neutral.tone(72) : Ink.tone(30),
    // 라이트 보드에는 칩 테두리가 없다 — 값 사다리가 금색 나무에서 이미 분리된다.
    // 다크 보드에서는 사다리가 나무 명도 안으로 들어오므로 테두리가 **필수**다.
    ...(dark ? { "board-chip-rim": Neutral.tone(88) } : {}),
  };
}

export const LightScheme = scheme(false);
export const DarkScheme = scheme(true);

/**
 * 검은 배경(OLED) — 다크 위에 덧씌운다. 앱 `Theme.kt` 의 `amoled()` 그대로.
 *
 * 페이지만 톤 0 이고, 컨테이너는 Material 의 다크 간격을 지켜 6 · 10 · 14 · 19 에 둔다 — 그림자가 보이지
 * 않는 검정 위에서도 카드가 면의 차이로 떠 있어야 하기 때문이다(테두리가 없으니 경계는 이것뿐이다).
 * 판은 다크 나무 그대로다: 판은 페이지 **위에** 그려지는 것이지 페이지가 아니다.
 */
export const AmoledScheme: Scheme = {
  ...DarkScheme,
  background: Mist.tone(0),
  surface: Mist.tone(0),
  "surface-dim": Mist.tone(0),
  "surface-container-lowest": Mist.tone(0),
  "surface-container-low": Mist.tone(6),
  "surface-container": Mist.tone(10),
  "surface-container-high": Mist.tone(14),
  "surface-container-highest": Mist.tone(19),
  "surface-bright": Mist.tone(24),
};

/** AMOLED 가 다크 위에 바꾸는 토큰 — 생성기가 덧씌움 블록만 굽는 데 쓴다. */
export const AMOLED_KEYS = Object.keys(AmoledScheme).filter(
  (k) => JSON.stringify(AmoledScheme[k]) !== JSON.stringify(DarkScheme[k]),
);

/**
 * 보드 화면의 나무색 팔레트 — 앱 `WoodTheme`/`woodScheme`(UI 개편 2차 M5 보정 · 판 색 요청, 2026-10-29).
 *
 * Mornye 가 재생 화면을 앨범 색으로 물들이듯 보드 화면 전체(페이지 · 카드 · 툴바 키 · ▶)를 판의 나무
 * 색상각(Maple 70°)으로. 따뜻한 판과 차가운 보라 시트 · 배경의 색온도가 부딪쳤던 것(실기 검토)을 푼다.
 * 다른 화면은 보라 그대로다.
 *
 * - 종이(paper)는 Maple 색상각의 아주 낮은 채도(라이트 0.014 · 다크 0.012), 잉크(ink)는 0.018.
 * - ▶(primary)는 판의 또 다른 재료 — **돌**의 색: 낮에는 흑돌 먹색, 밤에는 백돌 흰색. 처음에는 나무 램프의
 *   어두운 톤에서 뽑았더니 겨자 갈색(«똥색»)이었다.
 * - ‹ › · 선택(secondary-container)은 연한 메이플(라이트, 채도 0.035) / 종이 그 자체(다크 — 어두운 톤은 채도가
 *   조금만 있어도 갈색으로 읽힌다).
 * - 판의 스킨 · 판 위 값 색 · 평가 바 · 그래프는 그대로다 — 거기서 색은 값이다. 검은 배경(AMOLED)은 면을
 *   바꾸지 않고 강조만 바꾼다(검정 유지).
 *
 * 램프는 앱처럼 그 자리에서 만든다(앱 `Color.kt` 의 이름 있는 램프가 아니므로 톤 골든 밖이다 — 같은
 * `TonalRamp` 계산이라 값은 앱과 같다).
 */
function woodScheme(dark: boolean): Scheme {
  const paper = ramp(Maple.hue, dark ? 0.012 : 0.014);
  const ink = ramp(Maple.hue, 0.018);
  const pale = ramp(Maple.hue, 0.035);
  return dark
    ? {
        primary: paper.tone(92),
        "on-primary": ink.tone(12),
        "primary-container": paper.tone(30),
        "on-primary-container": paper.tone(92),
        "secondary-container": paper.tone(28),
        "on-secondary-container": paper.tone(92),
        "on-surface-variant": ink.tone(78),
        "outline-variant": paper.tone(32),
        background: paper.tone(10),
        surface: paper.tone(10),
        "surface-variant": paper.tone(26),
        "surface-container-lowest": paper.tone(7),
        "surface-container-low": paper.tone(14),
        "surface-container": paper.tone(18),
        "surface-container-high": paper.tone(22),
        "surface-container-highest": paper.tone(26),
      }
    : {
        primary: ink.tone(22),
        "on-primary": paper.tone(99),
        "primary-container": pale.tone(88),
        "on-primary-container": ink.tone(20),
        "secondary-container": pale.tone(89),
        "on-secondary-container": ink.tone(24),
        "on-surface-variant": ink.tone(38),
        "outline-variant": paper.tone(84),
        background: paper.tone(98),
        surface: paper.tone(98),
        "surface-variant": paper.tone(90),
        "surface-container-lowest": paper.tone(100),
        "surface-container-low": paper.tone(96),
        "surface-container": paper.tone(94),
        "surface-container-high": paper.tone(91),
        "surface-container-highest": paper.tone(89),
      };
}

/**
 * 보드 화면에 덧씌우는 토큰(라이트 · 다크). 검은 배경에서는 생성기가 그 위에 다시 검은 면(`AMOLED_KEYS`)을 얹어
 * 강조만 나무로 남긴다(앱: `if (black) return accents`).
 */
export const WoodLight: Scheme = woodScheme(false);
export const WoodDark: Scheme = woodScheme(true);

/** 대비 시험이 보는 쌍 — 앱의 테마 시험이 지키던 성질을 그대로 옮긴다. */
export const CONTRAST_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["on-background", "background"],
  ["on-surface", "surface"],
  ["on-surface-variant", "surface-variant"],
  ["on-primary", "primary"],
  ["on-primary-container", "primary-container"],
  ["on-secondary", "secondary"],
  ["on-secondary-container", "secondary-container"],
  ["on-tertiary", "tertiary"],
  ["on-tertiary-container", "tertiary-container"],
  ["on-error", "error"],
  ["on-error-container", "error-container"],
  ["inverse-on-surface", "inverse-surface"],
  // 카드 · 그룹 행의 면 위 글자(Z1 — 면이 페이지와 다른 톤이 되었다).
  ["on-surface", "surface-container"],
  ["on-surface-variant", "surface-container"],
  ["on-surface", "surface-container-high"],
  ["on-surface-variant", "surface-container-high"],
];

/**
 * 데스크톱 판 — 나무 대신 UI 와 같은 색상각(MistVariant 298°)의 회색조(2026-11-08 사용자 요청: 크롬 · 레일 ·
 * 인스펙터가 모두 중성인 데스크톱 창에서 판만 누런 나무라 겉돌았다). 웹 · 앱의 판은 그대로 나무다.
 *
 * **톤은 나무 판과 같다**(라이트 76 · 70 · 40 · 30, 다크 33 · 26 · 52 · 70) — 바뀌는 것은 색상과 채도뿐이라
 * 값 칩 · 흰 돌 · 좌표 글자의 대비가 나무 판과 같은 자리에 선다(다크의 칩 테두리도 그대로 필요하다).
 * 생성기가 `:root[data-desktop]` 아래로 굽는다.
 */
function desktopBoard(dark: boolean): Scheme {
  return {
    "board-wood": MistVariant.tone(dark ? 33 : 76),
    "board-wood-edge": MistVariant.tone(dark ? 26 : 70),
    "board-line": MistVariant.tone(dark ? 52 : 40),
    "board-label": MistVariant.tone(dark ? 70 : 30),
  };
}

export const DesktopBoardLight: Scheme = desktopBoard(false);
export const DesktopBoardDark: Scheme = desktopBoard(true);
