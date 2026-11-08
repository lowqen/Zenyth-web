import { describe, expect, it } from "vitest";
import { shareCardModel, wrapChars, type ShareCardInput } from "./share-card";
import type { MoveQuality } from "../review/move-quality";

const base: ShareCardInput = {
  title: "",
  ruleName: "Renju",
  size: 15,
  moveCount: 3,
  date: "2026-11-08",
  review: null,
  moves: "h8i9j10",
};

describe("공유 카드 (데스크톱 Z4)", () => {
  it("리뷰가 없으면 안내만 — 정확도 · 곡선 · 등급 없음", () => {
    const m = shareCardModel(base);
    expect(m.title).not.toBe("");
    expect(m.meta).toContain("15x15");
    expect(m.meta).toContain("2026-11-08");
    expect(m.accuracy).toBeNull();
    expect(m.winRates).toBeNull();
    expect(m.grades).toEqual([]);
    expect(m.hint).not.toBeNull();
    expect(m.moves).toBe("h8i9j10");
  });

  it("리뷰가 있으면 정확도 · 집계에 있는 등급만(Yixin 순서, 강제 수 제외)", () => {
    const counts = new Map<MoveQuality, readonly [number, number]>([
      ["blunder", [1, 0]],
      ["best", [2, 3]],
      ["forced", [4, 4]],
      ["good", [0, 0]],
    ]);
    const m = shareCardModel({
      ...base,
      title: "결승",
      review: {
        tally: { counts, blackAccuracy: 87.25, whiteAccuracy: null },
        winRates: [0.5, 0.6, 0.4],
      },
    });
    expect(m.title).toBe("결승");
    expect(m.accuracy?.[0]).toBe("87.3%");
    expect(m.grades.map((g) => g.quality)).toEqual(["best", "blunder"]);
    expect(m.grades[0]!.label).toContain("2 / 3");
    expect(m.winRates).toEqual([0.5, 0.6, 0.4]);
    expect(m.hint).toBeNull();
  });

  it("수순 줄 나누기 — 글자 폭으로, 줄 수 제한", () => {
    const measure = (s: string) => s.length * 10;
    expect(wrapChars("abcdefg", 30, measure, 9)).toEqual(["abc", "def", "g"]);
    expect(wrapChars("abcdefg", 30, measure, 2)).toEqual(["abc", "def"]);
    expect(wrapChars("", 30, measure, 2)).toEqual([]);
  });
});
