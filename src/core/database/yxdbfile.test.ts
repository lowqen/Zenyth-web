import { describe, expect, it } from "vitest";
import {
  lz4CompressBlock,
  lz4CompressBound,
  Lz4FrameDecoder,
  Lz4FrameEncoder,
  xxh32,
  Xxh32,
} from "./lz4frame";
import {
  compareYxdbKeys,
  keyStoneCount,
  metaRecord,
  readYxdb,
  YxdbRecordParser,
  YxdbWriter,
} from "./yxdbfile";
import { canonicalKey, decodeKey, KeyHasher, keyOfMoves, transform } from "./yxdbkey";
import { move, type Move } from "../model/move";

const enc = (s: string) => new TextEncoder().encode(s);

/** 결정적 의사 난수(시험용). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** 프레임을 `step` 바이트씩 넣어 푼다. */
function decodeAll(frame: Uint8Array, step: number, verify = true): Uint8Array {
  const out: Uint8Array[] = [];
  const d = new Lz4FrameDecoder((b, o, l) => out.push(b.slice(o, o + l)), { verify });
  for (let p = 0; p < frame.length; p += step) d.push(frame.subarray(p, p + step));
  d.end();
  return concat(out);
}

function encodeAll(data: Uint8Array, blockKB: 64 | 4096 = 64, pieces = 3): Uint8Array {
  const out: Uint8Array[] = [];
  const e = new Lz4FrameEncoder((c) => out.push(c), blockKB);
  const cut = Math.floor(data.length / pieces);
  for (let i = 0; i < pieces; i++)
    e.write(data, i * cut, i === pieces - 1 ? data.length - i * cut : cut);
  e.finish();
  return concat(out);
}

describe("xxh32", () => {
  it("공개 기준값과 같다", () => {
    expect(xxh32(new Uint8Array(0))).toBe(0x02cc5d05);
    expect(xxh32(enc("abc"))).toBe(0x32d153ff);
  });
  it("조각으로 넣어도 같다", () => {
    const r = rng(1);
    const data = Uint8Array.from({ length: 1000 }, () => r() & 0xff);
    const h = new Xxh32();
    for (let p = 0; p < data.length; p += 7) h.update(data, p, Math.min(7, data.length - p));
    expect(h.digest()).toBe(xxh32(data));
  });
});

describe("LZ4 프레임", () => {
  const r = rng(7);
  // 압축되는 자료(되풀이 + 잡음) 200KB — 64KB 블록 넷
  const text = Uint8Array.from({ length: 200_000 }, (_, i) =>
    i % 97 < 60 ? (i % 13) + 65 : r() & 0xff,
  );
  const noise = Uint8Array.from({ length: 70_000 }, () => r() & 0xff);

  it.each([1, 7, 4096, 1 << 20])("왕복 — %i 바이트씩 넣기", (step) => {
    expect(decodeAll(encodeAll(text), step)).toEqual(text);
  });

  it("압축 안 되는 블록은 원본 그대로 싣는다", () => {
    const f = encodeAll(noise);
    expect(f.length).toBeLessThan(noise.length + 64);
    expect(decodeAll(f, 333)).toEqual(noise);
  });

  it("빈 자료 · 작은 자료", () => {
    expect(decodeAll(encodeAll(new Uint8Array(0), 64, 1), 1)).toEqual(new Uint8Array(0));
    const small = enc("hello");
    expect(decodeAll(encodeAll(small, 64, 1), 2)).toEqual(small);
  });

  it("블록 압축은 실제로 줄인다", () => {
    const dst = new Uint8Array(lz4CompressBound(text.length));
    const n = lz4CompressBlock(text, 0, text.length, dst, 0, new Int32Array(1 << 16));
    expect(n).toBeLessThan(text.length * 0.7);
  });

  /** 연결 블록 프레임을 손으로 — 둘째 블록의 매치가 첫 블록을 가리킨다(엔진 파일과 같은 방식). */
  function linkedFrame(independent: boolean): Uint8Array {
    const flg = 0x40 | (independent ? 0x20 : 0);
    const head = new Uint8Array([0x04, 0x22, 0x4d, 0x18, flg, 0x40, 0]);
    head[6] = (xxh32(head, 4, 2) >>> 8) & 0xff;
    const b1 = new Uint8Array([0x80, ...enc("abcdefgh")]); // 리터럴 8
    const b2 = new Uint8Array([0x04, 0x08, 0x00, 0x10, 0x5a]); // 매치(오프셋 8, 길이 8) · 리터럴 "Z"
    const size = (n: number) => new Uint8Array([n, 0, 0, 0]);
    return concat([head, size(b1.length), b1, size(b2.length), b2, size(0)]);
  }

  it("연결 블록 — 앞 블록 창을 가리키는 매치", () => {
    const want = enc("abcdefghabcdefghZ");
    for (const step of [1, 3, 100]) expect(decodeAll(linkedFrame(false), step)).toEqual(want);
  });

  it("독립 블록에서 앞 블록을 가리키면 망가진 파일", () => {
    expect(() => decodeAll(linkedFrame(true), 100)).toThrow(/오프셋/);
  });

  it("잘린 파일 · 체크섬 불일치를 알아챈다", () => {
    const f = encodeAll(text);
    expect(() => decodeAll(f.subarray(0, f.length - 3), 1000)).toThrow(/잘림/);
    const bad = f.slice();
    bad[bad.length - 1]! ^= 1; // 내용 체크섬
    expect(() => decodeAll(bad, 1000)).toThrow(/체크섬/);
    expect(decodeAll(bad, 1000, false)).toEqual(text); // 확인을 끄면 넘어간다
  });

  it("연속 프레임 · 건너뛸 프레임", () => {
    const skip = new Uint8Array([0x50, 0x2a, 0x4d, 0x18, 3, 0, 0, 0, 1, 2, 3]);
    const f = concat([encodeAll(enc("one ")), skip, encodeAll(enc("two"))]);
    expect(new TextDecoder().decode(decodeAll(f, 5))).toBe("one two");
  });
});

// ── yixindb 레코드 ───────────────────────────────────────────────────

interface Rec {
  key: Uint8Array;
  value: Uint8Array;
}

function value(label: string, v = 0, depth = 0, text = ""): Uint8Array {
  const t = enc(text);
  const b = new Uint8Array(5 + t.length);
  b[0] = label.charCodeAt(0);
  new DataView(b.buffer).setInt16(1, v, true);
  new DataView(b.buffer).setInt16(3, depth, true);
  b.set(t, 5);
  return b;
}

function writeDb(recs: Rec[], compress: boolean): Uint8Array {
  const out: Uint8Array[] = [];
  const w = new YxdbWriter(recs.length, (c) => out.push(c), { compress, blockKB: 64 });
  for (const r of recs) {
    const buf = concat([r.key, r.value]);
    w.record(buf, 0, r.key.length, r.key.length, r.value.length);
  }
  w.finish();
  return concat(out);
}

function sampleRecs(n: number): Rec[] {
  const r = rng(3);
  const m = metaRecord();
  const recs: Rec[] = [{ key: m.key, value: m.value }];
  for (let i = 0; i < n; i++) {
    const stones = 1 + (r() % 40);
    const moves: Move[] = [];
    const used = new Set<number>();
    while (moves.length < stones) {
      const c = r() % 225;
      if (used.has(c)) continue;
      used.add(c);
      moves.push(move(c % 15, Math.floor(c / 15)));
    }
    const text = i % 50 === 0 ? "주석 ".repeat(1 + (i % 7)) : "";
    recs.push({
      key: keyOfMoves(2, 15, moves),
      value: i % 9 === 0 ? new Uint8Array(0) : value("w", i, 3, text),
    });
  }
  return recs;
}

function parseAll(bytes: Uint8Array, step: number) {
  const got: { key: number[]; value: number[] }[] = [];
  const p = new YxdbRecordParser((b, ko, kl, vo, vl) => {
    got.push({ key: [...b.subarray(ko, ko + kl)], value: [...b.subarray(vo, vo + vl)] });
  });
  for (let o = 0; o < bytes.length; o += step) p.push(bytes, o, Math.min(step, bytes.length - o));
  p.end();
  return { got, parser: p };
}

describe("yixindb 레코드", () => {
  const recs = sampleRecs(500);
  const raw = writeDb(recs, false);
  const want = recs.map((r) => ({ key: [...r.key], value: [...r.value] }));

  it.each([1, 2, 5, 61, 100_000])("조각 경계(%i 바이트)와 무관하게 같은 레코드", (step) => {
    const { got, parser } = parseAll(raw, step);
    expect(parser.count).toBe(recs.length);
    expect(got).toEqual(want);
  });

  it("잘리면 Error, 남은 바이트는 센다", () => {
    expect(() => parseAll(raw.subarray(0, raw.length - 1), 999)).toThrow(/잘림/);
    const extra = concat([raw, new Uint8Array([1, 2, 3])]);
    expect(parseAll(extra, 999).parser.trailing).toBe(3);
  });

  it("readYxdb: LZ4 · 압축 안 함 모두 · 멈추기", async () => {
    for (const compress of [true, false]) {
      const bytes = writeDb(recs, compress);
      const blob = new Blob([bytes as BlobPart]);
      let n = 0;
      const r = await readYxdb(
        blob,
        () => {
          n++;
        },
        { verify: true },
      );
      expect(r).toMatchObject({
        count: recs.length,
        read: recs.length,
        compressed: compress,
        trailing: 0,
      });
      expect(n).toBe(recs.length);
      const stop = await readYxdb(blob, (_b, _ko, _kl, _vo, _vl, i) => i < 9);
      expect(stop.stopped).toBe(true);
      expect(stop.read).toBe(10);
    }
  });

  it("작성기는 머리의 레코드 수와 다르면 닫지 않는다", () => {
    const w = new YxdbWriter(2, () => {});
    const k = keyOfMoves(2, 15, [move(7, 7)]);
    w.record(k, 0, k.length, 0, 0);
    expect(() => w.finish()).toThrow(/레코드 수/);
  });
});

describe("키 순서 · 정규화", () => {
  it("엔진 순서: 규칙 · 판 · 돌 수가 바이트보다 먼저", () => {
    const a = keyOfMoves(2, 15, [move(14, 14)]); // 1돌, 큰 좌표
    const b = keyOfMoves(2, 15, [move(7, 7), move(0, 0)]); // 2돌
    expect(compareYxdbKeys(a, 0, a.length, b, 0, b.length)).toBeLessThan(0);
    const c = keyOfMoves(1, 15, [move(7, 7), move(0, 0), move(1, 1)]);
    expect(compareYxdbKeys(c, 0, c.length, a, 0, a.length)).toBeLessThan(0); // 규칙이 먼저
  });

  it("패스 칸은 돌로 세지 않는다", () => {
    // 흑 (7,7) · 패스 칸 — 흑 구역이 2칸(흑 1 + 패스), 백 1칸
    const k = new Uint8Array([2, 15, 15, 7, 7, 0xff, 0xff, 7, 8]);
    expect(keyStoneCount(k, 0, k.length)).toBe(2);
    expect(decodeKey(k)).toMatchObject({ pass: true, black: [move(7, 7)], white: [move(7, 8)] });
    expect(new KeyHasher().load(k, 0, k.length)).toBe(false);
  });

  it("8 대칭 어느 쪽에서 만들어도 같은 정규 키 · 같은 대칭 해시", () => {
    const moves = [move(7, 7), move(8, 6), move(9, 9), move(5, 10), move(3, 3)];
    const base = keyOfMoves(2, 15, moves);
    const h = new KeyHasher();
    h.load(base, 0, base.length);
    h.hash();
    h.canon();
    const [bh, bl] = [h.hi, h.lo];
    for (let t = 0; t < 8; t++) {
      const tm = moves.map((m) => {
        const [x, y] = transform(t, m.x, m.y, 14);
        return move(x, y);
      });
      const k = keyOfMoves(2, 15, tm);
      expect(k).toEqual(base);
      // 정규화하지 않은(변환된) 키로 해시해도 같다
      const raw = new Uint8Array(3 + 2 * tm.length);
      raw.set([2, 15, 15]);
      const order = [...tm.filter((_, i) => i % 2 === 0), ...tm.filter((_, i) => i % 2 === 1)];
      order.forEach((m, i) => raw.set([m.x, m.y], 3 + 2 * i));
      h.load(raw, 0, raw.length);
      h.hash();
      h.canon();
      expect([h.hi, h.lo]).toEqual([bh, bl]);
    }
  });

  it("부모 후보 해시 = 그 부모 정규 키의 해시", () => {
    const moves = [move(7, 7), move(8, 6), move(9, 9), move(5, 10), move(3, 3)];
    const k = keyOfMoves(2, 15, moves);
    const h = new KeyHasher();
    h.load(k, 0, k.length);
    h.hash();
    const d = decodeKey(k)!;
    const p = new KeyHasher();
    for (let i = h.lastFrom; i < h.lastTo; i++) {
      h.without(i);
      const black = d.black.filter((_, j) => j !== i);
      const pk = canonicalKey(2, 15, black, d.white);
      p.load(pk, 0, pk.length);
      p.hash();
      p.canon();
      expect([h.hi, h.lo]).toEqual([p.hi, p.lo]);
    }
  });
});

describe("parseRuleBoard", () => {
  it("ruleBoardName 을 거꾸로", async () => {
    const { parseRuleBoard, ruleBoardName } = await import("./yxdbfile");
    for (const [r, w, h] of [
      [2, 15, 15],
      [0, 20, 20],
      [1, 15, 20],
      [7, 9, 9],
    ] as const)
      expect(parseRuleBoard(ruleBoardName(r, w, h))).toEqual({ rule: r, w, h });
    expect(parseRuleBoard("weird")).toBeNull();
  });
});
