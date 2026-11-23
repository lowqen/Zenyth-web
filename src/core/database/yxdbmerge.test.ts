import { describe, expect, it } from "vitest";
import { COUNT, NONSTD, representative } from "../opening/opening26";
import { move, type Move } from "../model/move";
import { compareYxdbKeys, metaRecord, readYxdb, YxdbCancelled, YxdbWriter } from "./yxdbfile";
import { keyOfMoves, keyToHex } from "./yxdbkey";
import {
  blobSpill,
  countYxdb,
  mergeYxdb,
  sortedRuns,
  YxdbUnsorted,
  type MergeOptions,
  type MergeSource,
} from "./yxdbmerge";
import { countSplit, runSplit, type SplitPlan } from "./yxdbsplit";

/** 병합 · 분리(라이브러리 계획 §7 · L3) — 왕복(나눈 것을 다시 합치면 원본과 같다) · 겹침 · 취소. */

const RENJU = 2;
interface Rec {
  key: Uint8Array;
  value: Uint8Array;
}

function val(label: string, depth = 0, text = ""): Uint8Array {
  const t = new TextEncoder().encode(text);
  const b = new Uint8Array(5 + t.length);
  b[0] = label ? label.charCodeAt(0) : 0;
  const db = (depth << 2) | 3;
  b[3] = db & 0xff;
  b[4] = (db >> 8) & 0xff;
  b.set(t, 5);
  return b;
}

const sortRecs = (recs: Rec[]) =>
  recs.sort((a, b) => compareYxdbKeys(a.key, 0, a.key.length, b.key, 0, b.key.length));

/** 주형 몇 개의 대표 수에서 뻗은 수순 — 모든 접두 국면, 결정적인 무작위 값 · 주석. 엔진 순서 + 메타데이터. */
function corpus(): Rec[] {
  let s = 7;
  const rnd = (n: number) => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s % n);
  const map = new Map<string, Rec>();
  const add = (line: readonly Move[]) => {
    for (let i = 0; i <= line.length; i++) {
      const key = keyOfMoves(RENJU, 15, line.slice(0, i));
      const h = keyToHex(key);
      if (map.has(h)) continue;
      const r = rnd(6);
      const value =
        r === 0
          ? new Uint8Array(0)
          : val("wldx"[r % 4]!, rnd(20), r === 5 ? `주석 ${map.size}` : "");
      map.set(h, { key, value });
    }
  };
  for (const op of [0, 3, 4, 13, 17]) {
    for (let k = 0; k < 4; k++) {
      const line = [...representative(op)];
      const used = new Set(line.map((m) => m.x * 32 + m.y));
      while (line.length < 9) {
        const m = move(4 + rnd(7), 4 + rnd(7));
        if (used.has(m.x * 32 + m.y)) continue;
        used.add(m.x * 32 + m.y);
        line.push(m);
      }
      add(line);
    }
  }
  // 부모 없는 국면(미분류)
  add([move(1, 1), move(2, 2), move(3, 1)].slice(0, 3));
  const m = metaRecord();
  return [{ key: m.key, value: m.value }, ...sortRecs([...map.values()])];
}

function blobOf(recs: readonly Rec[], compress = true): Blob {
  const out: Uint8Array[] = [];
  const w = new YxdbWriter(recs.length, (c) => out.push(c), { blockKB: 64, compress });
  for (const r of recs) w.recordKV(r.key, 0, r.key.length, r.value, 0, r.value.length);
  w.finish();
  return new Blob(out as BlobPart[]);
}

async function recordsOf(blob: Blob): Promise<string[]> {
  const out: string[] = [];
  await readYxdb(
    blob,
    (b, ko, kl, vo, vl) => void out.push(keyToHex(b, ko, kl) + ":" + keyToHex(b, vo, vl)),
  );
  return out;
}

const DEEPER: MergeOptions = { policy: "deeper", joinComments: true };

/** 미리 보기 → 쓰기 두 번 흐름(화면과 같다). */
async function merge(sources: MergeSource[], opts: MergeOptions = DEEPER) {
  const pre = await mergeYxdb(sources, opts);
  const spill = blobSpill(256);
  const sum = await mergeYxdb(sources, opts, {
    count: pre.records,
    sink: (c) => spill.write(c),
    blockKB: 64,
  });
  expect(sum).toEqual(pre);
  return { blob: spill.finish(), summary: pre };
}

const src = (blobs: Blob[]): MergeSource[] => blobs.map((blob, rank) => ({ blob, rank }));

describe("병합", () => {
  const recs = corpus();
  const original = blobOf(recs);

  it("겹치지 않는 둘 → 원본과 같은 레코드 · 순서", async () => {
    const meta = recs[0]!;
    const a = [meta, ...recs.slice(1).filter((_, i) => i % 2 === 0)];
    const b = [meta, ...recs.slice(1).filter((_, i) => i % 2 === 1)];
    const { blob, summary } = await merge(src([blobOf(a), blobOf(b, false)]));
    expect(await recordsOf(blob)).toEqual(await recordsOf(original));
    expect(summary.overlaps).toBe(0);
    expect(summary.positions).toBe(recs.length - 1);
    expect(summary.records).toBe(recs.length);
    expect(summary.inputPositions).toEqual([a.length - 1, b.length - 1]);
    expect(await countYxdb(blob)).toBe(recs.length);
  });

  it("같은 파일 둘 → 모두 겹치고 값이 다른 것은 없다", async () => {
    const { blob, summary } = await merge(src([original, original]));
    expect(summary.overlaps).toBe(recs.length - 1);
    expect(summary.differing).toBe(0);
    expect(await recordsOf(blob)).toEqual(await recordsOf(original));
  });

  describe("겹칠 때", () => {
    const meta = recs[0]!;
    const k = recs[5]!.key;
    const only = recs[6]!;
    const A = blobOf([meta, { key: k, value: val("l", 4, "가") }]);
    const B = blobOf(
      sortRecs([meta, { key: k, value: val("w", 8, "나") }, only]).sort((x, y) =>
        compareYxdbKeys(x.key, 0, x.key.length, y.key, 0, y.key.length),
      ),
    );
    const valueOf = async (blob: Blob) =>
      (await recordsOf(blob)).find((r) => r.startsWith(keyToHex(k) + ":"))!.split(":")[1]!;

    it("더 깊은 기록 — 깊이 큰 쪽, 주석은 이어 붙인다", async () => {
      const { blob, summary } = await merge(src([A, B]));
      expect(summary).toMatchObject({ overlaps: 1, differing: 1, positions: 2 });
      expect(await valueOf(blob)).toBe(keyToHex(val("w", 8, "가\n나")));
    });

    it("기준 우선 — 맨 위 입력, 주석 이어 붙이기 끔", async () => {
      const { blob } = await merge(src([A, B]), { policy: "base", joinComments: false });
      expect(await valueOf(blob)).toBe(keyToHex(val("l", 4, "가")));
    });

    it("깊이가 같으면 W/L/D 로 풀린 쪽, 같은 주석은 하나로", async () => {
      const X = blobOf([meta, { key: k, value: val("x", 6, "같음") }]);
      const Y = blobOf([meta, { key: k, value: val("d", 6, "같음") }]);
      const { blob } = await merge(src([X, Y]));
      expect(await valueOf(blob)).toBe(keyToHex(val("d", 6, "같음")));
    });

    it("기록 없는 칸은 늘 진다 — 다른 쪽 주석도 살린다", async () => {
      const X = blobOf([meta, { key: k, value: new Uint8Array(0) }]);
      const Y = blobOf([meta, { key: k, value: val("l", 1, "글") }]);
      const { blob, summary } = await merge(src([X, Y]), { policy: "base", joinComments: true });
      expect(summary.differing).toBe(0);
      expect(await valueOf(blob)).toBe(keyToHex(val("l", 1, "글")));
    });
  });

  it("키 순서가 아닌 입력 → YxdbUnsorted, 묶음으로 정렬하면 합쳐진다", async () => {
    const shuffled = [recs[0]!, ...recs.slice(1).reverse()];
    const bad = blobOf(shuffled);
    await expect(mergeYxdb(src([original, bad]), DEEPER)).rejects.toBeInstanceOf(YxdbUnsorted);
    const runs = await sortedRuns(bad, () => blobSpill(64), { runBytes: 300 });
    expect(runs.length).toBeGreaterThan(2);
    const { blob, summary } = await merge(runs.map((b) => ({ blob: b, rank: 0 })));
    expect(summary.overlaps).toBe(0); // 같은 입력의 묶음끼리는 겹침이 아니다
    expect(await recordsOf(blob)).toEqual(await recordsOf(original));
  });

  it("취소", async () => {
    await expect(
      mergeYxdb(src([original, original]), { ...DEEPER, isCancelled: () => true }),
    ).rejects.toBeInstanceOf(YxdbCancelled);
  });

  it("미리 보기와 수가 다르면(그새 바뀜) 쓰기가 멈춘다", async () => {
    await expect(
      mergeYxdb(src([original]), DEEPER, { count: recs.length - 1, sink: () => {} }),
    ).rejects.toThrow(/레코드 수/);
    await expect(
      mergeYxdb(src([original]), DEEPER, { count: recs.length + 1, sink: () => {} }),
    ).rejects.toThrow(/레코드 수/);
  });
});

describe("분리", () => {
  const recs = corpus();
  const original = blobOf(recs);
  const total = recs.length - 1;

  async function split(plan: SplitPlan, meta = true) {
    const n = plan.outputs.length + (plan.rest ? 1 : 0);
    const spills = Array.from({ length: n }, () => blobSpill(1024));
    const got = await runSplit(
      original,
      plan,
      spills.map((s) => (c: Uint8Array) => s.write(c)),
      meta,
    );
    return { got, blobs: spills.map((s) => s.finish()) };
  }

  it("미리 보기 — 모든 기준의 통", async () => {
    const c = await countSplit(original, {
      rule: RENJU,
      size: 15,
      black: [move(7, 7)],
      white: [],
    });
    expect(c.total).toBe(total);
    expect(c.meta).toBe(true);
    expect(c.openings).toHaveLength(COUNT + 1);
    expect(c.openings!.reduce((a, b) => a + b, 0)).toBe(total);
    expect(c.openings![NONSTD]).toBeGreaterThan(0);
    expect(c.rules).toEqual({ "renju-15": total });
    const solved = recs
      .slice(1)
      .filter((r) => r.value.length && "wld".includes(String.fromCharCode(r.value[0]!))).length;
    expect(c.solved).toBe(solved);
    // 천원 흑 한 점 아래 = 빈 판 · 떨어진 국면들을 뺀 전부
    expect(c.under).toBeGreaterThan(total / 2);
    expect(c.under).toBeLessThan(total);
  });

  it("왕복 — 주형마다 한 파일로 나눈 것을 다시 합치면 원본과 같다", async () => {
    const c = await countSplit(original, null);
    const buckets = c.openings!.map((n, i) => ({ i, n })).filter((x) => x.n > 0);
    expect(buckets.length).toBeGreaterThanOrEqual(5);
    const { got, blobs } = await split({
      criterion: "opening",
      outputs: buckets.map((b) => ({ buckets: [b.i], count: b.n })),
    });
    expect(got).toEqual(buckets.map((b) => b.n));
    for (const [i, b] of blobs.entries()) expect(await countYxdb(b)).toBe(buckets[i]!.n + 1);
    const { blob } = await merge(src(blobs));
    expect(await recordsOf(blob)).toEqual(await recordsOf(original));
  });

  it("이 국면 아래 + 나머지(옮기기) — 합계 = 원본, 다시 합치면 같다", async () => {
    const base = { rule: RENJU, size: 15, black: [move(7, 7)], white: [] as Move[] };
    const c = await countSplit(original, base, { withOpenings: false });
    expect(c.openings).toBeNull();
    const { got, blobs } = await split({
      criterion: "under",
      base,
      outputs: [{ buckets: ["in"], count: c.under! }],
      rest: { count: total - c.under! },
    });
    expect(got[0]! + got[1]!).toBe(total);
    const { blob } = await merge(src(blobs));
    expect(await recordsOf(blob)).toEqual(await recordsOf(original));
  });

  it("풀린 국면만 · 규칙 · 판", async () => {
    const c = await countSplit(original, null, { withOpenings: false });
    const s = await split({
      criterion: "solved",
      outputs: [{ buckets: ["solved"], count: c.solved }],
    });
    expect(await countYxdb(s.blobs[0]!)).toBe(c.solved + 1);
    const r = await split({
      criterion: "rule",
      outputs: [{ buckets: ["renju-15"], count: total }],
    });
    expect(await recordsOf(r.blobs[0]!)).toEqual(await recordsOf(original));
  });

  it("미리 보기와 수가 다르면 던진다 · 취소", async () => {
    await expect(
      split({ criterion: "solved", outputs: [{ buckets: ["solved"], count: 0 }] }),
    ).rejects.toThrow(/레코드 수/);
    await expect(
      runSplit(original, { criterion: "solved", outputs: [] }, [], true, {
        isCancelled: () => true,
      }),
    ).rejects.toBeInstanceOf(YxdbCancelled);
  });

  it("대칭 — 돌린 기준 국면도 같은 «아래»", async () => {
    const line = representative(4);
    const base = (t: (m: Move) => Move) => ({
      rule: RENJU,
      size: 15,
      black: [t(line[0]!), t(line[2]!)],
      white: [t(line[1]!)],
    });
    const a = await countSplit(
      original,
      base((m) => m),
      { withOpenings: false },
    );
    const b = await countSplit(
      original,
      base((m) => move(14 - m.y, m.x)),
      { withOpenings: false },
    );
    expect(a.under).toBeGreaterThan(0);
    expect(b.under).toBe(a.under);
  });
});
