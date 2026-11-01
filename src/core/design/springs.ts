/**
 * 판 밖 크롬의 스프링(Z9) — 앱 `ChromeMotion.kt` 의 네 스프링(Material 3 Expressive 의 감쇠비 · 강성)을 CSS 로.
 *
 * CSS 에는 스프링이 없다. 그래서 단위 계단에 대한 질량 1 스프링의 해를 시간축으로 고르게 표본 내어
 * `linear()` 이징 하나와 «멈출 때까지 걸리는 시간» 하나로 굽는다(`gen-tokens.ts` → `--spring-*`). 같은
 * 시간 동안 같은 곡선이라 앱의 스프링과 같은 모양으로 움직이고, 같은 때 멈춘다.
 *
 *  - **spatial** — 자리 · 크기 · 모서리. 조금 튄다(감쇠비 < 1).
 *  - **effects** — 불투명도 · 색. 넘치지 않는다(감쇠비 1) — 목표를 넘은 색은 다른 색이다.
 *
 * 판 · 평가 바 · 실시간 숫자에는 쓰지 않는다(`MOTION` 의 네 규칙 그대로, 앱 D6).
 */
export interface Spring {
  /** 감쇠비 ζ. */
  damping: number;
  /** 강성 k(질량 1, N/m) — 고유 진동수 ω = √k. */
  stiffness: number;
}

export const SPRINGS = {
  /** 작은 부품: 칩 · 체크 · 단추 · 세그먼트 알약. */
  spatialFast: { damping: 0.6, stiffness: 800 },
  /** 목록 항목 · 판넬 · 시트. */
  spatial: { damping: 0.8, stiffness: 380 },
  effectsFast: { damping: 1, stiffness: 3800 },
  effects: { damping: 1, stiffness: 1600 },
} as const satisfies Record<string, Spring>;

/** 시각 t(초)에서 0 → 1 계단을 따르는 자리. */
export function springAt({ damping: z, stiffness }: Spring, t: number): number {
  const w = Math.sqrt(stiffness);
  if (z >= 1) return 1 - Math.exp(-w * t) * (1 + w * t); // 임계 감쇠
  const wd = w * Math.sqrt(1 - z * z);
  return (
    1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z / Math.sqrt(1 - z * z)) * Math.sin(wd * t))
  );
}

/** 목표에서 `tolerance` 안으로 들어와 다시 나가지 않는 첫 시각(ms, 정수). */
export function settleMs(s: Spring, tolerance = 0.002): number {
  let last = 0;
  for (let ms = 0; ms <= 3000; ms++)
    if (Math.abs(1 - springAt(s, ms / 1000)) > tolerance) last = ms;
  return last + 1;
}

/**
 * `linear()` 이징 — 멈출 때까지를 `samples` 칸으로 고르게 나눈 표본. 마지막 점은 정확히 1(끝에서 튀지 않게).
 */
export function springEasing(s: Spring, samples = 32): { ms: number; easing: string } {
  const ms = settleMs(s);
  const pts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const v = i === samples ? 1 : springAt(s, ((i / samples) * ms) / 1000);
    pts.push(String(Math.round(v * 1000) / 1000));
  }
  return { ms, easing: `linear(${pts.join(", ")})` };
}

/**
 * `linear()` 를 모르는 브라우저(사파리 17.2 전)의 대신 — 같은 성질의 3차 곡선. 튀는 것은 튀게, 넘치지 않는 것은
 * 넘치지 않게.
 */
export const SPRING_FALLBACK: Record<keyof typeof SPRINGS, string> = {
  spatialFast: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  spatial: "cubic-bezier(0.2, 0.9, 0.25, 1.04)",
  effectsFast: "cubic-bezier(0.2, 0, 0, 1)",
  effects: "cubic-bezier(0.2, 0, 0, 1)",
};
