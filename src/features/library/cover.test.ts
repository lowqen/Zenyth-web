import { describe, expect, it } from "vitest";
import type { DbStats } from "../../core/database/yxdbindex";
import { keyOfMoves, keyToHex } from "../../core/database/yxdbkey";
import { RULE_RENJU } from "../../core/database/yxdbfile";
import { move } from "../../core/model/move";
import { coverKeyOf, dominantOpening } from "./cover";
import { movesOfKey, startMovesOf } from "./libraryStore";

const stats = (openings?: number[]): DbStats => ({
  records: 10,
  rules: { "renju-15": 10 },
  labels: { W: 0, L: 0, D: 0, other: 0 },
  commented: 0,
  ...(openings ? { openings } : {}),
});

describe("커버 열쇠", () => {
  const ops = new Array<number>(27).fill(0);
  ops[4] = 50;
  ops[20] = 10;
  ops[26] = 900;

  it("자동 = 가장 많은 주형 — 미분류(27번째 칸)는 세지 않는다", () => {
    expect(dominantOpening(stats(ops))).toBe(4);
    expect(coverKeyOf({ mode: "auto", seed: 3 }, stats(ops))).toBe(4);
  });

  it("분류가 없거나 통계가 없으면 자동도 «일식», 무늬로 둘 중 하나", () => {
    expect(coverKeyOf({ mode: "auto", seed: 2 }, stats(new Array(27).fill(0)))).toBe("e0");
    expect(coverKeyOf({ mode: "auto", seed: 3 })).toBe("e1");
  });

  it("주형을 고르면 그 주형, 범위 밖이면 «일식»", () => {
    expect(coverKeyOf({ mode: "opening", opening: 17, seed: 0 }, stats(ops))).toBe(17);
    expect(coverKeyOf({ mode: "opening", opening: 26, seed: 1 })).toBe("e1");
    expect(coverKeyOf({ mode: "eclipse", seed: 0 }, stats(ops))).toBe("e0");
  });
});

describe("뿌리 키 → 판에 놓을 수", () => {
  it("흑 · 백을 번갈아 놓아 같은 국면이 된다(키는 대칭 정규화라 같은 키로 돌아온다)", () => {
    const moves = [move(7, 7), move(8, 6), move(9, 9), move(6, 6), move(5, 9)];
    const hex = keyToHex(keyOfMoves(RULE_RENJU, 15, moves));
    const out = movesOfKey(hex, 15)!;
    expect(out).toHaveLength(5);
    expect(keyToHex(keyOfMoves(RULE_RENJU, 15, out))).toBe(hex);
  });

  it("빈 판은 빈 수순, 판 크기가 다르거나 키가 이상하면 null", () => {
    expect(movesOfKey(keyToHex(keyOfMoves(RULE_RENJU, 15, [])), 15)).toEqual([]);
    expect(movesOfKey(keyToHex(keyOfMoves(RULE_RENJU, 20, [move(1, 1)])), 15)).toBeNull();
    expect(movesOfKey("zz", 15)).toBeNull();
  });
});

describe("DB 의 시작 국면", () => {
  it("이 판 크기로 읽히는 가장 큰 뿌리 — 뿌리가 없으면 null", () => {
    const big = [move(7, 7), move(8, 8), move(9, 7)];
    const roots = [
      { key: keyToHex(keyOfMoves(RULE_RENJU, 20, [move(1, 1)])), subtree: 900 },
      { key: keyToHex(keyOfMoves(RULE_RENJU, 15, big)), subtree: 500 },
      { key: keyToHex(keyOfMoves(RULE_RENJU, 15, [])), subtree: 10 },
    ];
    const out = startMovesOf({ ...stats(), roots }, 15)!;
    expect(keyToHex(keyOfMoves(RULE_RENJU, 15, out))).toBe(roots[1]!.key);
    expect(startMovesOf(stats(), 15)).toBeNull();
    expect(startMovesOf(undefined, 15)).toBeNull();
  });

  it("뿌리에 시작점이 있으면 그곳(색인 판 3)", () => {
    const deep = [move(7, 7), move(7, 6), move(7, 5), move(9, 9), move(5, 7)];
    const roots = [
      {
        key: keyToHex(keyOfMoves(RULE_RENJU, 15, [])),
        subtree: 900,
        start: keyToHex(keyOfMoves(RULE_RENJU, 15, deep)),
      },
    ];
    const out = startMovesOf({ ...stats(), roots }, 15)!;
    expect(out).toHaveLength(5);
    expect(keyToHex(keyOfMoves(RULE_RENJU, 15, out))).toBe(roots[0]!.start);
  });
});
