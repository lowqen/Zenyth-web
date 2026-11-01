import { describe, expect, it } from "vitest";
import { SPRINGS, settleMs, springAt, springEasing } from "./springs";

describe("크롬 스프링(Z9 — 앱 ChromeMotion)", () => {
  it("0 에서 시작해 1 에 멈춘다", () => {
    for (const s of Object.values(SPRINGS)) {
      expect(springAt(s, 0)).toBeCloseTo(0, 9);
      expect(springAt(s, settleMs(s) / 1000)).toBeCloseTo(1, 2);
    }
  });

  it("spatial 은 조금 넘치고, effects 는 넘치지 않는다(넘친 색은 다른 색)", () => {
    const peak = (s: (typeof SPRINGS)[keyof typeof SPRINGS]) => {
      let m = 0;
      for (let ms = 0; ms < 1000; ms++) m = Math.max(m, springAt(s, ms / 1000));
      return m;
    };
    expect(peak(SPRINGS.spatialFast)).toBeGreaterThan(1.05);
    expect(peak(SPRINGS.spatial)).toBeGreaterThan(1.005);
    expect(peak(SPRINGS.effects)).toBeLessThanOrEqual(1);
    expect(peak(SPRINGS.effectsFast)).toBeLessThanOrEqual(1);
  });

  it("멈추는 시간은 크롬답게 짧다(반 초 안)", () => {
    for (const s of Object.values(SPRINGS)) expect(settleMs(s)).toBeLessThan(500);
    expect(settleMs(SPRINGS.effectsFast)).toBeLessThan(settleMs(SPRINGS.effects));
  });

  it("linear() 는 0 으로 시작해 정확히 1 로 끝난다", () => {
    const { easing } = springEasing(SPRINGS.spatialFast);
    expect(easing).toMatch(/^linear\(0, /);
    expect(easing).toMatch(/, 1\)$/);
  });
});
