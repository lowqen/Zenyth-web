/**
 * 색이 아닌 토큰 — 타이포 15슬롯, 간격, 모서리, 모션, 레이아웃.
 *
 * `Type.kt` / `Spacing.kt` / `Shape.kt` / `Motion.kt` 를 한 자리에 옮긴 것이다.
 * 색과 같은 파일에서 굽는 이유는 하나다: `gen:tokens --check` 하나가 이것들까지
 * 지켜야 «TS 에서 고치고 CSS 는 잊는» 사고가 안 난다.
 */

/**
 * 본문은 Pretendard(가변, 동적 서브셋)다. 예전에는 시스템 폰트만 썼다 — 앱과 일치, 40MB 앱에
 * 폰트를 더할 이유가 없음, COEP 가 외부 폰트를 막음. UI 개편(.calm-design/DESIGN.md)에서 뒤집었다:
 *
 * - 시스템 폰트는 OS 마다 한글 자형 · 굵기 · 자간이 달라(윈도우 맑은 고딕 · 맥 SD 고딕) 같은 화면이
 *   기기마다 다른 밀도로 보였다. 차분한 화면은 글꼴 하나에서 시작한다.
 * - 외부가 아니라 **번들 안**이다(`main.tsx` 가 `pretendard` npm 의 CSS 를 들인다). CSP
 *   `font-src 'self'` · COEP 아래서 그대로 뜬다.
 * - 동적 서브셋이라 화면에 실제로 나온 글자의 조각(각 30~60KB)만 받는다. 엔진 40MB 앞에서 작다.
 *
 * 받기 전과 받지 못한 곳은 시스템 폰트로 물러선다(`font-display: swap`).
 */
export const FONT_STACKS = {
  sans: `"Pretendard Variable", Pretendard, system-ui, -apple-system, "Segoe UI", sans-serif`,
  mono: `ui-monospace, SFMono-Regular, "Cascadia Mono", Consolas, "D2Coding", monospace`,
} as const;

export interface TypeSlot {
  weight: number;
  size: number;
  line: number;
  /** px. 0 또는 음수만 — Material 의 양수 트래킹은 라틴용이라 한글이 성기게 보인다. */
  tracking?: number;
}

/**
 * **열다섯 슬롯 전부** — 앱 `Type.kt` 와 같은 값. 셋만 손대고 열두 개를 Material 기본값에 두면 두 개의
 * 스케일이 동시에 도는 것이다 — 카드 제목과 그 아래 라벨이 다른 체계에서 온다.
 *
 * 크기가 아니라 **굵기**가 위계를 진다. 2026-10-29 앱이 제목 · 본문을 한 단씩 키웠고(«너무 작고 빽빽하다»),
 * 웹도 같이 간다(docs/engineering-notes.md §8 Z2). 라벨은 그대로다 — 칩 · 탭 · 수치 아래 글처럼 조밀한 자리다.
 */
export const TYPE: Record<string, TypeSlot> = {
  "display-large": { weight: 400, size: 44, line: 52, tracking: -0.5 },
  "display-medium": { weight: 400, size: 34, line: 42, tracking: -0.4 },
  "display-small": { weight: 400, size: 28, line: 36, tracking: -0.3 },

  "headline-large": { weight: 600, size: 28, line: 36, tracking: -0.4 },
  // 페이지 제목(앱 M2): 목록 화면의 큰 머리가 접히기 전에 보이는 것. 아주 굵게.
  "headline-medium": { weight: 800, size: 34, line: 42, tracking: -0.6 },
  "headline-small": { weight: 600, size: 21, line: 28, tracking: -0.2 },

  "title-large": { weight: 600, size: 22, line: 28, tracking: -0.2 },
  "title-medium": { weight: 600, size: 17, line: 24, tracking: -0.1 },
  "title-small": { weight: 500, size: 15, line: 22 },

  "body-large": { weight: 400, size: 16, line: 24 },
  "body-medium": { weight: 400, size: 15, line: 22 },
  "body-small": { weight: 400, size: 14, line: 20 },

  "label-large": { weight: 500, size: 14, line: 20 },
  "label-medium": { weight: 500, size: 12, line: 16 },
  "label-small": { weight: 500, size: 11, line: 16 },

  // ── 슬롯 밖, 앱이 따로 둔 셋 ──
  // 그룹 행의 제목과 그 아래 줄(앱 `RowTitleStyle` · `RowNoteStyle`): 행은 크기가, 페이지 제목은 굵기가 진다.
  "row-title": { weight: 400, size: 18, line: 26, tracking: -0.2 },
  "row-note": { weight: 400, size: 15, line: 21 },
  // 그룹 위의 섹션 머리(앱 `ConnectedGroup` 제목): 강조색 15 SemiBold — 색은 CSS 가 준다.
  "section-title": { weight: 600, size: 15, line: 22 },
};

/** 콘솔과 좌표 줄. */
export const MONO = { size: 13, line: 18 } as const;

/** 4dp 격자에 반 단계 하나. `Spacing.kt`. */
export const SPACE = { xs: 2, s: 4, m: 8, l: 12, xl: 16, xxl: 24 } as const;

/**
 * 하나의 모서리 스케일, 다섯 단계 + 카드. `Shape.kt` · `Tokens.kt`.
 * `card` 20 은 앱 UI 개편 2차 M1 의 카드 · 그룹 면(테두리를 뺀 면은 모서리가 조금 더 둥글어야 면으로 읽힌다).
 */
export const RADIUS = { xs: 4, s: 8, m: 12, l: 16, card: 20, xl: 28 } as const;

/**
 * 네 규칙, 예외 없음(`Motion.kt`):
 * 미끄러지지 않는다 / 200ms 를 넘지 않는다 / 실시간 숫자는 보간하지 않는다 /
 * 증명 하트비트 500ms 는 그대로 둔다.
 */
export const MOTION = { quick: 150, panel: 180, value: 200, heartbeat: 500 } as const;

/**
 * 화면의 리듬 — 앱 `Tokens.kt` 의 `ZenythTokens.Standard`. 2026-10-29 «화면이 빽빽하다»는 요청으로 앱이 한 단
 * 넓혔고(그때 웹은 따라가지 않았다), Z2 에서 웹도 같은 값이 됐다.
 */
export const RHYTHM = {
  /** 스크롤하는 모든 화면의 카드 둘레. 좁은 폭도 같다. */
  screenPadding: 16,
  /** 목록의 카드 사이. */
  listGap: 12,
  /** 카드 안쪽, 그리고 카드 안의 것들 사이. */
  cardPadding: 20,
  cardSpacing: 14,
  /** 연결 그룹의 한 행 안쪽. */
  rowPaddingH: 20,
  rowPaddingV: 16,
  /** 그룹 행의 최소 높이(앱 M2). */
  rowMinHeight: 64,
  /** Material 의 최소 터치 크기. */
  minTouch: 48,
} as const;

/** 앱의 `WideLayoutMin` / `ReadingWidth` 상수를 그대로 쓴다. */
export const LAYOUT = {
  readingWidth: 640,
  wideMin: 640,
  /** 내비게이션이 하단 탭으로 바뀌는 폭 — 앱 모습 그대로. */
  compactMax: 640,
  railWide: 1280,
  railIconOnly: 1024,
} as const;
