/**
 * `core/designsystem/theme/Color.kt` 의 이식본 — 열네 개의 램프(앱과 같은 순서).
 *
 * **먹과 한지.** 크롬(카드·바·칩·버튼)은 따뜻하고 거의 무채색이고, 화면에서
 * 채도 있는 색은 보드의 것이다: 분석의 값 칩, 나무, 등급 표시. 취향이 아니라
 * 작동 규칙이다 — 이 앱에서 **색은 값**이라, 칩의 색상이 수의 좋고 나쁨을 말한다.
 * UI 까지 색으로 소리치면 읽는 사람이 둘을 구별해야 한다. 그래서 UI 는 물러나고
 * 보드가 말한다.
 */
import { ramp } from "./oklch";

/** 따뜻한 목탄 → 강조 가족. 거의 무채색이어야 «먹»으로 읽힌다. */
export const Ink = ramp(74, 0.02);

/** 한지: 배경과 표면. 청회색으로 읽히지 않을 만큼만 따뜻하다. */
export const Neutral = ramp(74, 0.007);

/** 윤곽선과 흐린 글자 — 같은 종이에 몸이 조금 더 있는 것. */
export const NeutralVariant = ramp(74, 0.016);

/** 보드의 녹색, 데스크톱의 `#81B64C` 를 가라앉힌 것. */
export const Sage = ramp(148, 0.06);

/**
 * 보드 금색의 가족. 나무와 «오류 아닌 주의»에 쓴다.
 *
 * hue·chroma 는 톤 76 이 데스크톱의 보드(`#DCB35C` → `#DAB673`)에, 톤 42 가
 * 그 격자(`#7A5A2B` → `#7B5E22`)에 떨어지도록 고른 값이다. 수년을 본 보드는
 * 실수로 다시 디자인할 것이 아니다 — 먼저 재현하고, 그 다음에 유도한다.
 * 이 두 값은 `ramps.test.ts` 의 골든 앵커다.
 */
export const Clay = ramp(82, 0.095);

/**
 * 2026-10-29 부터 앱의 판 나무: 메이플. [Clay] 의 금색에서 살구빛 쪽으로 한 걸음.
 * 82° 금색은 판이 지켜야 하는 중간 밝기에서 폰 화면에 탁한 올리브로 읽혔다(앱 «탁한 올리브판»).
 * **색상각만** 옮겼다 — 톤 76 은 그대로 판의 밝기다. 값 칩과 흰 돌의 대비가 그 밝기에 묶여 있다.
 * 웹도 같은 판을 쓴다(docs/앱-디자인-정렬-계획.md Q2). [Clay] 는 «주의» 색으로 남는다.
 */
export const Maple = ramp(70, 0.075);

/** 등불 아래의 같은 나무. **재료**가 바뀐 것이라 톤이 아니라 램프를 따로 둔다. [Maple] 의 색상각을 따른다. */
export const WoodNight = ramp(70, 0.05);

/**
 * 강조색: 채운 버튼 · 선택된 탭과 칩 · 스위치 · 툴바의 ▶ — 조작하는 것, 그리고 값을 싣지 않는 것.
 * 로열 블루가 아니라 딥 바이올렛인 것은 측정 때문이다: 270° 면 다크 버튼이 «흑 승» 파랑(245°)과
 * OKLab 0.050 로 붙는다. 298° 면 가장 가까운 의미색이 0.085(다크) · 0.09(라이트) 떨어진다.
 */
export const Violet = ramp(298, 0.09);

/** 강조색의 조용한 짝: 선택된 칩 · 세그먼트 · 내비게이션 알약. */
export const Lilac = ramp(298, 0.035);

/**
 * 페이지와 면(앱 UI 개편 2차 M1): 강조색 쪽으로 아주 살짝 기운 흰색. 종이와 강조가 한 색상각이라
 * 한 팔레트로 읽히고, 따뜻한 판의 나무가 그 위에서 선다. [Neutral] · [NeutralVariant] 는 결과색과
 * 판의 돌이 계속 쓴다.
 */
export const Mist = ramp(298, 0.005);

/** 페이지의 회색 글자와 윤곽 — [Mist] 보다 몸이 조금 더 있는 것. */
export const MistVariant = ramp(298, 0.012);

/** 오류, 금수, 손실 — 유일하게 큰 소리를 내는 가족. */
export const Signal = ramp(27, 0.13);

/** 모든 통계 표에서 «흑 승». 데스크톱과 앱이 공유한다. */
export const ResultBlue = ramp(245, 0.085);

/** «백 승». 흰색이 아니라 녹색인 이유: 종이 위의 흰색은 아무것도 아니다. */
export const ResultGreen = ramp(155, 0.085);

export const ALL_RAMPS = {
  Ink,
  Neutral,
  NeutralVariant,
  Sage,
  Clay,
  Maple,
  WoodNight,
  Violet,
  Lilac,
  Mist,
  MistVariant,
  Signal,
  ResultBlue,
  ResultGreen,
} as const;

export type RampName = keyof typeof ALL_RAMPS;
