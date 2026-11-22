import { describe, expect, it } from "vitest";
import { classify, NONSTD } from "../opening/opening26";
import { move, type Move } from "../model/move";
import { compareYxdbKeys, metaRecord, YxdbCancelled, YxdbWriter } from "./yxdbfile";
import { indexBudget, indexBytesEstimate, scanYxdb } from "./yxdbindex";
import { decodeKey, hexToKey, keyOfMoves, keyToHex } from "./yxdbkey";

const RENJU = 2;
const C = move(7, 7);
// 직접(H9) 줄과 간접(I9) 줄 — 다섯째 수에서 같은 국면으로 모인다(주형 사이의 전이)
const W1 = move(7, 6);
const B2 = move(7, 5);
const W2 = move(8, 6);
const B3 = move(9, 5);
const LINE1 = [C, W1, B2, W2, B3];
const LINE2 = [C, W2, B3, W1, B2];
const ISOLATED = [move(1, 1), move(2, 2), move(3, 1), move(13, 13), move(1, 3), move(12, 12)];

interface Rec {
  key: Uint8Array;
  value: Uint8Array;
}

const val = (label: string, text = "") => {
  const t = new TextEncoder().encode(text);
  const b = new Uint8Array(5 + t.length);
  b[0] = label.charCodeAt(0);
  b.set(t, 5);
  return b;
};

/** 수순들의 모든 접두 국면(+ 따로 떨어진 국면) — 엔진 순서로. */
function buildRecs(order: "engine" | "reversed" = "engine"): Rec[] {
  const map = new Map<string, Rec>();
  const addLine = (line: readonly Move[], upto = line.length) => {
    for (let i = 0; i <= upto; i++) {
      const key = keyOfMoves(RENJU, 15, line.slice(0, i));
      map.set(keyToHex(key), {
        key,
        value: i === 5 ? val("w", "모임") : i % 2 ? val("l") : new Uint8Array(0),
      });
    }
  };
  addLine(LINE1);
  addLine(LINE2);
  const iso = keyOfMoves(RENJU, 15, ISOLATED);
  map.set(keyToHex(iso), { key: iso, value: val("d") });
  const recs = [...map.values()].sort((a, b) =>
    compareYxdbKeys(a.key, 0, a.key.length, b.key, 0, b.key.length),
  );
  if (order === "reversed") recs.reverse();
  const m = metaRecord();
  return [{ key: m.key, value: m.value }, ...recs];
}

function blobOf(recs: Rec[]): Blob {
  const out: Uint8Array[] = [];
  const w = new YxdbWriter(recs.length, (c) => out.push(c), { blockKB: 64 });
  for (const r of recs) {
    const buf = new Uint8Array(r.key.length + r.value.length);
    buf.set(r.key);
    buf.set(r.value, r.key.length);
    w.record(buf, 0, r.key.length, r.key.length, r.value.length);
  }
  w.finish();
  return new Blob(out as BlobPart[]);
}

describe("scanYxdb", () => {
  const D = classify([C, W1, B2]);
  const I = classify([C, W2, B3]);

  it("시험 자료의 두 줄은 서로 다른 주형", () => {
    expect(D).toBeLessThan(13);
    expect(I).toBeGreaterThanOrEqual(13);
    expect(I).not.toBe(NONSTD);
  });

  it("통계 · 주형(부모 사슬만) · 뿌리", async () => {
    const r = await scanYxdb(blobOf(buildRecs()));
    expect(r.sorted).toBe(true);
    expect(r.countOrdered).toBe(true);
    // 빈 판 · 1돌 · 2돌 둘 · 3돌 둘 · 4돌 둘 · 5돌(모임) 하나 · 떨어진 6돌
    expect(r.stats.records).toBe(10);
    expect(r.stats.rules).toEqual({ "renju-15": 10 });
    expect(r.stats.labels).toEqual({ W: 1, L: 3, D: 1, other: 0 }); // 1돌 · 3돌 둘 · 모임 · 떨어진 국면
    expect(r.stats.commented).toBe(1);
    const o = r.stats.openings!;
    expect(o).toHaveLength(27);
    expect(o[D]).toBe(2); // 3돌 · 4돌
    expect(o[I]).toBe(2);
    // 3돌 미만 넷 + 두 주형에서 모인 5돌(추측하지 않는다) + 부모 없는 6돌
    expect(o[NONSTD]).toBe(6);
    expect(o.reduce((a, b) => a + b, 0)).toBe(10);
    expect(r.stats.roots!.map((x) => x.subtree)).toEqual([9, 1]);
    const top = decodeKey(hexToKey(r.stats.roots![0]!.key))!;
    expect(top.black.length + top.white.length).toBe(0); // 빈 판
    expect(hexToKey(r.stats.roots![1]!.key)).toEqual(keyOfMoves(RENJU, 15, ISOLATED));
  });

  it("돌 수 순서가 아닌 파일 — 주형은 건너뛰고 뿌리는 같다", async () => {
    const r = await scanYxdb(blobOf(buildRecs("reversed")));
    expect(r.sorted).toBe(false);
    expect(r.countOrdered).toBe(false);
    expect(r.openingsSkipped).toBe("unordered");
    expect(r.stats.openings).toBeUndefined();
    expect(r.stats.roots!.map((x) => x.subtree)).toEqual([9, 1]);
  });

  it("메모리 관문 — 넘으면 통계만", async () => {
    const r = await scanYxdb(blobOf(buildRecs()), { maxIndexBytes: 1000 });
    expect(r.indexSkipped).toBe("memory");
    expect(r.stats.records).toBe(10);
    expect(r.stats.openings).toBeUndefined();
    expect(r.stats.roots).toBeUndefined();
  });

  it("통계만", async () => {
    const r = await scanYxdb(blobOf(buildRecs()), { index: false });
    expect(r.stats.records).toBe(10);
    expect(r.indexBytes).toBeUndefined();
  });

  it("취소", async () => {
    await expect(scanYxdb(blobOf(buildRecs()), { isCancelled: () => true })).rejects.toBeInstanceOf(
      YxdbCancelled,
    );
  });

  it("진행은 0..1 로 끝난다", async () => {
    const seen: number[] = [];
    await scanYxdb(blobOf(buildRecs()), { onProgress: (p) => seen.push(p.fraction) });
    expect(seen.at(-1)).toBe(1);
    expect(seen.every((f) => f >= 0 && f <= 1)).toBe(true);
  });
});

describe("메모리 관문 수치", () => {
  it("표본(817만 국면) 추정 ≈ 140MB — 4GB 기기는 하고 2GB 는 건너뛴다", () => {
    const est = indexBytesEstimate(8_171_741);
    expect(est / 2 ** 20).toBeGreaterThan(130);
    expect(est / 2 ** 20).toBeLessThan(150);
    expect(est).toBeLessThan(indexBudget(4));
    expect(est).toBeGreaterThan(indexBudget(2));
    expect(indexBudget(undefined)).toBe(indexBudget(4));
  });
});
