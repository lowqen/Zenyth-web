// RYDB PoC (DB I/O 계획 3단계, 방안 B) — yixindb 를 국면 트리 + zstd 블록으로 바꾸고, 그 파일만으로
// 메모리 색인을 세워 크기 · 적재 시간 · 메모리를 잰다. 엔진 통합 전의 측정용이다.
//
//   node rydb-poc.mjs convert <in.db> <out.rydb> [zstdLevel=9]
//   node rydb-poc.mjs load    <in.rydb>                 적재만(별도 프로세스로 메모리를 잰다)
//   node rydb-poc.mjs verify  <in.db> <in.rydb>         모든 기록을 대조 + 키 바이트 표본 대조
//
// 형식 (이 PoC 의 v1):
//   header 32B : "RYDB" u16 version u16 flags u32 nodes u32 roots u32 blocks u32 rawBytes u32 textNodes u32 0
//   block idx  : blocks x (u32 compressedLen, u32 rawLen)
//   blocks     : DFS 노드 흐름을 64KB 단위로 잘라 zstd 로 압축한 것(경계는 노드 중간일 수 있다 — v1 은 통째 적재)
//   node       : hdr(1B) [move 1B, 루트가 아닐 때] [rawLabel 1B] [value zigzag varint] [depthbound zigzag varint]
//                [text: varint len + utf8] [childCount varint, hdr 의 31 일 때]
//     hdr      : bit0-1 라벨(0 기록 없음, 1 'w', 2 'l', 3 그 밖 → rawLabel) · bit2 주석 · bit3-7 자식 수(31 = varint)
//   root       : 흐름의 맨 위 단계. hdr 뒤에 move 대신 rule u8, w u8, h u8, n varint, 돌 n x 1B ((x<<4)|y)
//                (검은 돌 ceil(n/2) 개 다음 흰 돌 — yixindb 키와 같은 순서, 같은 좌표계)
//
// 자식의 돌 = 부모의 돌 + move(부모 노드의 「전파된 좌표계」로 적은 수). 전파된 좌표계는 루트의 좌표계에서
// 수를 더해 가며 내려온다 — 그래서 읽을 때 정규화(8대칭 중 최소 키)를 하지 않는다. 색인 키는 대칭 정규화
// Zobrist: 8가지 변환의 Zobrist 값 중 최솟값(어느 좌표계에서 세어도 같다). 부모 = 마지막에 둔 쪽의 돌
// 하나를 뺀 국면 중 DB 에 있는 것. 없으면 루트.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import zlib from "node:zlib";

import { lz4FrameDecode } from "./yxdb.mjs";

const BLOCK = 64 << 10;
const now = () => performance.now();
const mb = (n) => (n / 1048576).toFixed(1);

// ── Zobrist (64bit = 32bit 두 개) ─────────────────────────────────────
// 키 값은 SHA-256 에서 뽑는다 — xorshift 같은 선형 생성기의 출력은 XOR 하면 32차원에 갇혀
// 돌 수가 다른 국면끼리도 충돌한다(첫 시도에서 실제로 났다).
const zob = (i) => createHash("sha256").update(`rydb-zobrist-${i}`).digest();
// 칸 = (x<<4)|y (16줄까지). 색 c 는 256 단위.
const ZH = new Uint32Array(2 * 256);
const ZL = new Uint32Array(2 * 256);
for (let i = 0; i < ZH.length; i++) {
  const d = zob(i);
  ZH[i] = d.readUInt32LE(0);
  ZL[i] = d.readUInt32LE(4);
}

// 변환 0..7 은 엔진 `applyTransform`(pos.h) 의 순서: IDENTITY, ROTATE_90, 180, 270, FLIP_X, FLIP_Y, FLIP_XY, FLIP_YX
function tx(t, x, y, s) {
  switch (t) {
    case 1:
      return [y, s - x];
    case 2:
      return [s - x, s - y];
    case 3:
      return [s - y, x];
    case 4:
      return [x, s - y];
    case 5:
      return [s - x, y];
    case 6:
      return [y, x];
    case 7:
      return [s - y, s - x];
    default:
      return [x, y];
  }
}
// TXT[((s*8)+t)*256 + 칸] = 변환된 칸 (s = 판 크기 - 1)
const TXT = new Uint8Array(16 * 8 * 256);
for (let sz = 0; sz < 16; sz++)
  for (let t = 0; t < 8; t++)
    for (let x = 0; x <= sz; x++)
      for (let y = 0; y <= sz; y++) {
        const [X, Y] = tx(t, x, y, sz);
        TXT[(sz * 8 + t) * 256 + ((x << 4) | y)] = (X << 4) | Y;
      }
/** 칸 p 에 색 c 돌을 놓거나 뺄 때 8 변환의 해시 벡터 v 를 갱신한다. */
function xorStone(v, c, p, s) {
  const base = s * 2048 + p;
  const cz = c << 8;
  for (let t = 0; t < 8; t++) {
    const q = cz | TXT[base + t * 256];
    v[2 * t] ^= ZH[q];
    v[2 * t + 1] ^= ZL[q];
  }
}
// compose[a][b] = a∘b (b 를 먼저)
const COMPOSE = [...Array(8)].map((_, a) =>
  [...Array(8)].map((_, b) => {
    const [bx, by] = tx(b, 1, 2, 14);
    const [ax, ay] = tx(a, bx, by, 14);
    for (let k = 0; k < 8; k++) {
      const [kx, ky] = tx(k, 1, 2, 14);
      if (kx === ax && ky === ay) return k;
    }
    throw new Error("compose");
  }),
);

/** 8 변환의 해시 벡터 — h[t*2], h[t*2+1]. */
function hashVec(out, stones, nb, n, s) {
  out.fill(0);
  for (let i = 0; i < n; i++)
    xorStone(out, i < nb ? 0 : 1, (stones[2 * i] << 4) | stones[2 * i + 1], s);
}
function minOf(v) {
  let bh = v[0],
    bl = v[1];
  for (let t = 1; t < 8; t++) {
    const h = v[2 * t],
      l = v[2 * t + 1];
    if (h < bh || (h === bh && l < bl)) ((bh = h), (bl = l));
  }
  return [bh, bl];
}

/** 엔진 `toSmallestDBKey` 와 같은 정규화 — 8 변환 중 (흑 정렬, 백 정렬) 돌 바이트가 가장 작은 것. */
function canonicalKey(rule, w, stones, nb, n) {
  const s = w - 1;
  let best = null;
  const cur = new Array(n);
  for (let t = 0; t < 8; t++) {
    for (let i = 0; i < n; i++) cur[i] = TXT[(s * 8 + t) * 256 + stones[i]];
    const b = cur.slice(0, nb).sort((a, c) => a - c);
    const wh = cur.slice(nb, n).sort((a, c) => a - c);
    const all = b.concat(wh);
    if (!best) best = all;
    else {
      for (let i = 0; i < n; i++) {
        if (all[i] === best[i]) continue;
        if (all[i] < best[i]) best = all; // (x<<4)|y 의 크기 순서 = (x, y) 바이트 memcmp 순서
        break;
      }
    }
  }
  const key = Buffer.alloc(3 + 2 * n);
  key[0] = rule;
  key[1] = w;
  key[2] = w;
  best.forEach((v, i) => ((key[3 + 2 * i] = v >> 4), (key[4 + 2 * i] = v & 15)));
  return key;
}

// ── 열린 주소 해시표: (hi, lo) → 값 u32 ─────────────────────────────
class Table {
  constructor(n, width = 3) {
    let cap = 1;
    while (cap < n / 0.7) cap <<= 1;
    this.cap = cap;
    this.w = width; // hi, lo, 값...
    this.a = new Uint32Array(cap * width);
    this.used = new Uint8Array(cap);
  }
  slot(hi, lo) {
    let i = (Math.imul(lo ^ (hi >>> 7), 0x9e3779b1) >>> 0) & (this.cap - 1);
    for (;;) {
      if (!this.used[i]) return i;
      const o = i * this.w;
      if (this.a[o] === hi && this.a[o + 1] === lo) return i;
      i = (i + 1) & (this.cap - 1);
    }
  }
  get(hi, lo) {
    const i = this.slot(hi, lo);
    return this.used[i] ? i : -1;
  }
}

// ── yixindb 읽기 ───────────────────────────────────────────────────
function parseYx(path) {
  const file = readFileSync(path);
  // 압축 안 한 yixindb(compressed_save = false)도 받는다
  const raw = file.readUInt32LE(0) === 0x184d2204 ? lz4FrameDecode(file) : file;
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const n = dv.getUint32(0, true);
  const keyOff = new Uint32Array(n + 1); // 키 바이트 시작(길이 u16 다음)
  const recOff = new Uint32Array(n);
  let off = 4;
  for (let i = 0; i < n; i++) {
    const kb = dv.getUint16(off, true);
    keyOff[i] = off + 2;
    off += 2 + kb;
    recOff[i] = off;
    off += 2 + dv.getUint16(off, true);
  }
  keyOff[n] = off;
  return { raw: Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength), dv, n, keyOff, recOff };
}
const keyLen = (Y, i) => Y.dv.getUint16(Y.keyOff[i] - 2, true);
/** 정상 키(정사각 15 이하, 패스 없음)면 돌 배열, 아니면 null. */
function stonesOf(Y, i, buf) {
  const k = Y.keyOff[i],
    kb = keyLen(Y, i);
  const w = Y.raw[k + 1],
    h = Y.raw[k + 2];
  if (w !== h || w === 0 || w > 16) return null;
  const n = (kb - 3) / 2;
  for (let j = 0; j < 2 * n; j++) {
    const v = Y.raw[k + 3 + j];
    if (v >= w) return null; // -1(패스) 또는 범위 밖
    buf[j] = v;
  }
  return n;
}

// ── 변환 ───────────────────────────────────────────────────────────
function convert(inPath, outPath, level) {
  const t0 = now();
  const Y = parseYx(inPath);
  const { n, raw, dv } = Y;
  console.log(`읽기 ${n} 기록 ${mb(raw.length)}MB ${((now() - t0) / 1000).toFixed(1)}s`);

  const st = new Uint8Array(1024);
  const vec = new Uint32Array(16);
  const H0h = new Uint32Array(n),
    H0l = new Uint32Array(n);
  const tbl = new Table(n);
  const special = new Uint8Array(n); // 1 = 메타 · 비정상 키 → 원시 루트
  let dups = 0;
  for (let i = 0; i < n; i++) {
    const m = stonesOf(Y, i, st);
    if (m === null) {
      special[i] = 1;
      continue;
    }
    const s = raw[Y.keyOff[i] + 1] - 1;
    hashVec(vec, st, (m + 1) >> 1, m, s);
    H0h[i] = vec[0];
    H0l[i] = vec[1];
    const [hi, lo] = minOf(vec);
    const j = tbl.slot(hi, lo);
    if (tbl.used[j]) {
      dups++; // 같은 국면이 두 번(엔진은 처음 것을 쓴다) — 원시 루트로 남긴다
      special[i] = 1;
      continue;
    }
    tbl.used[j] = 1;
    tbl.a[j * 3] = hi;
    tbl.a[j * 3 + 1] = lo;
    tbl.a[j * 3 + 2] = i;
  }
  const t1 = now();

  // 부모 찾기
  const parent = new Int32Array(n).fill(-1);
  const ctrans = new Uint8Array(n);
  const mstone = new Uint8Array(n); // (x<<4)|y, 이 노드의 좌표계에서
  const pv = new Uint32Array(16);
  let found = 0;
  for (let i = 0; i < n; i++) {
    if (special[i]) continue;
    const m = stonesOf(Y, i, st);
    if (m === 0) continue;
    const s = raw[Y.keyOff[i] + 1] - 1;
    const nb = (m + 1) >> 1;
    const lastBlack = m % 2 === 1;
    const from = lastBlack ? 0 : nb,
      to = lastBlack ? nb : m,
      c = lastBlack ? 0 : 1;
    hashVec(vec, st, nb, m, s);
    for (let k = from; k < to; k++) {
      const x = st[2 * k],
        y = st[2 * k + 1];
      pv.set(vec);
      xorStone(pv, c, (x << 4) | y, s);
      const [hi, lo] = minOf(pv);
      const slot = tbl.get(hi, lo);
      if (slot < 0) continue;
      const j = tbl.a[slot * 3 + 2];
      // C: 이 노드의 좌표계 → 부모 키의 좌표계. H_C(K-s) == H_0(부모)
      let C = -1;
      for (let t = 0; t < 8; t++)
        if (pv[2 * t] === H0h[j] && pv[2 * t + 1] === H0l[j]) {
          C = t;
          break;
        }
      if (C < 0) continue; // 있을 수 없다(해시 충돌)
      parent[i] = j;
      ctrans[i] = C;
      mstone[i] = (x << 4) | y;
      found++;
      break;
    }
  }
  const t2 = now();
  console.log(
    `색인 ${((t1 - t0) / 1000).toFixed(1)}s · 부모 찾기 ${((t2 - t1) / 1000).toFixed(1)}s — 부모 있음 ${found} (${((100 * found) / n).toFixed(1)}%), 같은 국면 중복 ${dups}`,
  );

  // 자식 목록(CSR)
  const cnt = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) if (parent[i] >= 0) cnt[parent[i] + 1]++;
  for (let i = 0; i < n; i++) cnt[i + 1] += cnt[i];
  const kids = new Uint32Array(found);
  const fill = cnt.slice(0, n);
  for (let i = 0; i < n; i++) if (parent[i] >= 0) kids[fill[parent[i]]++] = i;

  // DFS 직렬화
  const out = [];
  let cur = Buffer.allocUnsafe(1 << 20),
    p = 0;
  const ensure = (k) => {
    if (p + k > cur.length) {
      out.push(cur.subarray(0, p));
      cur = Buffer.allocUnsafe(Math.max(1 << 20, k));
      p = 0;
    }
  };
  const u8 = (v) => (cur[p++] = v);
  const varint = (v) => {
    while (v >= 0x80) ((cur[p++] = (v & 0x7f) | 0x80), (v >>>= 7));
    cur[p++] = v;
  };
  const zz = (v) => (v << 1) ^ (v >> 31);
  let textNodes = 0,
    roots = 0,
    nodes = 0;
  const A = new Uint8Array(n); // 노드의 키 좌표계 → 전파된 좌표계
  function emitRecord(i, childCount, writeHead) {
    const ro = Y.recOff[i],
      rb = dv.getUint16(ro, true);
    const label = rb > 0 ? raw[ro + 2] : 0;
    const code = rb === 0 ? 0 : label === 119 ? 1 : label === 108 ? 2 : 3;
    const textLen = rb > 5 ? rb - 5 : 0;
    ensure(64 + textLen + 2048);
    u8(code | (textLen ? 4 : 0) | (Math.min(childCount, 31) << 3));
    writeHead();
    if (code === 3) u8(label);
    if (rb > 0) {
      varint(zz(rb > 2 ? dv.getInt16(ro + 3, true) : 0) >>> 0);
      varint(zz(rb > 4 ? dv.getInt16(ro + 5, true) : 0) >>> 0);
    }
    if (textLen) {
      varint(textLen);
      raw.copy(cur, p, ro + 7, ro + 7 + textLen);
      p += textLen;
      textNodes++;
    }
    if (childCount >= 31) varint(childCount - 31);
    nodes++;
  }
  const order = (i) => {
    const list = Array.from(kids.subarray(cnt[i], cnt[i + 1]));
    // 자식의 move = A[i]∘C 로 옮긴 s — 정렬해서 쓴다(압축이 잘 된다)
    const s = raw[Y.keyOff[i] + 1] - 1;
    const withMove = list.map((k) => {
      const comp = COMPOSE[A[i]][ctrans[k]];
      const [x, y] = tx(comp, mstone[k] >> 4, mstone[k] & 15, s);
      A[k] = comp;
      return [k, (x << 4) | y];
    });
    withMove.sort((a, b) => a[1] - b[1]);
    return withMove;
  };
  const stack = [];
  for (let r = 0; r < n; r++) {
    if (parent[r] >= 0) continue;
    roots++;
    A[r] = 0;
    const kids0 = special[r] ? [] : order(r);
    emitRecord(r, kids0.length, () => {
      const k = Y.keyOff[r],
        kb = keyLen(Y, r);
      if (special[r]) {
        // 원시 루트: rule 0xFF 표시 + 키 바이트 그대로
        u8(0xff);
        varint(kb);
        ensure(kb);
        raw.copy(cur, p, k, k + kb);
        p += kb;
        return;
      }
      (u8(raw[k]), u8(raw[k + 1]), u8(raw[k + 2]));
      const m = (kb - 3) / 2;
      varint(m);
      for (let j = 0; j < m; j++) u8((raw[k + 3 + 2 * j] << 4) | raw[k + 4 + 2 * j]);
    });
    stack.length = 0;
    stack.push([kids0, 0]);
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top[1] >= top[0].length) {
        stack.pop();
        continue;
      }
      const [k, mv] = top[0][top[1]++];
      const ks = order(k);
      emitRecord(k, ks.length, () => u8(mv));
      stack.push([ks, 0]);
    }
  }
  out.push(cur.subarray(0, p));
  const body = Buffer.concat(out);
  const t3 = now();

  // 블록 압축
  const blocks = [];
  for (let o = 0; o < body.length; o += BLOCK) {
    const src = body.subarray(o, Math.min(o + BLOCK, body.length));
    blocks.push([
      zlib.zstdCompressSync(src, { params: { [zlib.constants.ZSTD_c_compressionLevel]: level } }),
      src.length,
    ]);
  }
  const hdr = Buffer.alloc(32 + blocks.length * 8);
  hdr.write("RYDB", 0, "latin1");
  hdr.writeUInt16LE(1, 4);
  hdr.writeUInt32LE(nodes, 8);
  hdr.writeUInt32LE(roots, 12);
  hdr.writeUInt32LE(blocks.length, 16);
  hdr.writeUInt32LE(body.length, 20);
  hdr.writeUInt32LE(textNodes, 24);
  blocks.forEach(
    ([c, r], i) => (hdr.writeUInt32LE(c.length, 32 + 8 * i), hdr.writeUInt32LE(r, 36 + 8 * i)),
  );
  const file = Buffer.concat([hdr, ...blocks.map((b) => b[0])]);
  writeFileSync(outPath, file);
  const t4 = now();
  console.log(
    `노드 ${nodes} (루트 ${roots}, 주석 ${textNodes}) · 흐름 ${mb(body.length)}MB · zstd-${level} 파일 ${mb(file.length)}MB` +
      ` · 직렬화 ${((t3 - t2) / 1000).toFixed(1)}s 압축 ${((t4 - t3) / 1000).toFixed(1)}s`,
  );
  return { nodes, roots, found, dups, file: file.length, body: body.length };
}

// ── 적재 (RYDB 만으로 색인을 세운다) ─────────────────────────────────
// 표 칸 = hi, lo, rec0 (label u8 | depthbound i16 << 8 ... 아래), rec1 — 16B. 주석은 Map(칸 → 문자열).
function load(path, sampleEvery = 0) {
  const samples = [];
  const rootSt = new Uint8Array(512),
    pathMv = new Uint8Array(512);
  let rootN = 0,
    rootRule = 0,
    rootW = 0;
  const t0 = now();
  const f = readFileSync(path);
  if (f.toString("latin1", 0, 4) !== "RYDB") throw new Error("RYDB 아님");
  const nodes = f.readUInt32LE(8),
    nblocks = f.readUInt32LE(16),
    rawLen = f.readUInt32LE(20);
  const tbl = new Table(nodes, 4);
  const texts = new Map();
  // 블록을 하나씩 풀어 이어 붙인 흐름 위에서 파싱한다(블록 경계가 노드 중간일 수 있어 작은 꼬리를 넘긴다)
  let off = 32 + nblocks * 8;
  let buf = Buffer.alloc(0),
    bp = 0;
  let bi = 0;
  const more = () => {
    const cl = f.readUInt32LE(32 + 8 * bi);
    const blk = zlib.zstdDecompressSync(f.subarray(off, off + cl));
    off += cl;
    bi++;
    buf = bp < buf.length ? Buffer.concat([buf.subarray(bp), blk]) : blk;
    bp = 0;
  };
  const need = (k) => {
    while (buf.length - bp < k && bi < nblocks) more();
  };
  const u8 = () => buf[bp++];
  const varint = () => {
    let v = 0,
      sh = 0,
      b;
    do {
      b = buf[bp++];
      v += (b & 0x7f) * 2 ** sh;
      sh += 7;
    } while (b & 0x80);
    return v;
  };
  const unzz = (v) => (v % 2 ? -(v + 1) / 2 : v / 2);

  // 단계별: 해시 벡터 16 u32 · 돌 수 · 크기 · 남은 자식 수
  const MAXD = 512;
  const H = new Uint32Array(MAXD * 16);
  const nst = new Int32Array(MAXD),
    size = new Int32Array(MAXD),
    left = new Int32Array(MAXD);
  let depth = -1,
    count = 0,
    rawRoots = 0;
  const rvec = new Uint32Array(16),
    tmp = new Uint8Array(1024);
  while (count < nodes) {
    need(4096);
    const hdr = u8();
    let isRawRoot = false;
    if (depth < 0) {
      // 루트
      const rule = u8();
      if (rule === 0xff) {
        const kb = varint();
        need(kb);
        bp += kb; // PoC: 원시 루트는 색인에 넣지 않는다(메타 기록 · 비정상 키 — 수가 아주 적다)
        isRawRoot = true;
        rawRoots++;
        depth = 0;
        nst[0] = -1;
      } else {
        const w = u8();
        u8();
        const m = varint();
        for (let j = 0; j < m; j++) {
          const b = u8();
          tmp[2 * j] = b >> 4;
          tmp[2 * j + 1] = b & 15;
        }
        hashVec(rvec, tmp, (m + 1) >> 1, m, w - 1);
        if (sampleEvery) {
          rootN = m;
          rootRule = rule;
          rootW = w;
          for (let j = 0; j < m; j++) rootSt[j] = (tmp[2 * j] << 4) | tmp[2 * j + 1];
        }
        depth = 0;
        H.set(rvec, 0);
        nst[0] = m;
        size[0] = w - 1;
      }
    } else {
      const mv = u8();
      const d = depth + 1;
      const pm = nst[depth],
        s = size[depth];
      const c = pm % 2 === 0 ? 0 : 1;
      H.copyWithin(d * 16, depth * 16, depth * 16 + 16);
      xorStone(H.subarray(d * 16, d * 16 + 16), c, mv, s);
      nst[d] = pm + 1;
      pathMv[d] = mv;
      size[d] = s;
      left[depth]--;
      depth = d;
    }
    const code = hdr & 3;
    const label = code === 0 ? 0 : code === 1 ? 119 : code === 2 ? 108 : u8();
    let value = 0,
      db = 0;
    if (code !== 0) {
      value = unzz(varint());
      db = unzz(varint());
    }
    let text = null;
    if (hdr & 4) {
      const tl = varint();
      need(tl);
      text = buf.toString("utf8", bp, bp + tl);
      bp += tl;
    }
    let kids = hdr >> 3;
    if (kids === 31) kids += varint();
    count++;
    if (!isRawRoot) {
      const v = H.subarray(depth * 16, depth * 16 + 16);
      const [hi, lo] = minOf(v);
      const i = tbl.slot(hi, lo);
      const o = i * 4;
      tbl.used[i] = 1;
      tbl.a[o] = hi;
      tbl.a[o + 1] = lo;
      tbl.a[o + 2] = label | (code === 0 ? 0x100 : 0) | ((value & 0xffff) << 16);
      tbl.a[o + 3] = db & 0xffff;
      if (text !== null) texts.set(i, text);
      if (sampleEvery && count % sampleEvery === 0) {
        // 전파된 좌표계의 돌: 루트의 흑 · 백 + 경로의 수(짝수 단계에서 둔 수는 흑이 아닐 수도 — 돌 수의 홀짝으로 가른다)
        const black = [],
          white = [];
        const rnb = (rootN + 1) >> 1;
        for (let j = 0; j < rootN; j++) (j < rnb ? black : white).push(rootSt[j]);
        for (let d = 1; d <= depth; d++) ((rootN + d) % 2 === 1 ? black : white).push(pathMv[d]);
        samples.push([
          i,
          canonicalKey(
            rootRule,
            rootW,
            black.concat(white),
            black.length,
            black.length + white.length,
          ),
        ]);
      }
    }
    left[depth] = kids;
    // 자식이 없으면 남은 자식이 있는 단계까지 올라간다
    while (depth >= 0 && left[depth] === 0) depth--;
  }
  const ms = now() - t0;
  return { tbl, texts, nodes, rawRoots, ms, rawLen, fileLen: f.length, samples };
}

function verify(dbPath, rydbPath) {
  const L = load(rydbPath, 97);
  console.log(`적재 ${L.nodes} 노드 ${(L.ms / 1000).toFixed(2)}s`);
  const Y = parseYx(dbPath);
  const st = new Uint8Array(1024),
    vec = new Uint32Array(16);
  let ok = 0,
    bad = 0,
    skipped = 0;
  const seen = new Uint8Array(L.tbl.cap);
  const origAt = new Int32Array(L.tbl.cap).fill(-1);
  for (let i = 0; i < Y.n; i++) {
    const m = stonesOf(Y, i, st);
    if (m === null) {
      skipped++;
      continue;
    }
    const s = Y.raw[Y.keyOff[i] + 1] - 1;
    hashVec(vec, st, (m + 1) >> 1, m, s);
    const [hi, lo] = minOf(vec);
    const slot = L.tbl.get(hi, lo);
    if (slot < 0 || seen[slot]) {
      if (bad++ < 5) console.log(`  ${slot < 0 ? "없음" : "중복"} #${i}`);
      continue;
    }
    seen[slot] = 1;
    origAt[slot] = i;
    const ro = Y.recOff[i],
      rb = Y.dv.getUint16(ro, true);
    const a2 = L.tbl.a[slot * 4 + 2],
      a3 = L.tbl.a[slot * 4 + 3];
    const label = rb > 0 ? Y.raw[ro + 2] : 0;
    const value = rb > 2 ? Y.dv.getInt16(ro + 3, true) : 0;
    const db = rb > 4 ? Y.dv.getInt16(ro + 5, true) : 0;
    const text = rb > 5 ? Y.raw.toString("utf8", ro + 7, ro + 7 + rb - 5) : null;
    const same =
      (a2 & 0xff) === label &&
      ((a2 & 0x100) !== 0) === (rb === 0) &&
      ((a2 >>> 16) << 16) >> 16 === value &&
      ((a3 & 0xffff) << 16) >> 16 === db &&
      (L.texts.get(slot) ?? null) === text;
    if (same) ok++;
    else if (bad++ < 5) console.log(`  다름 #${i}`);
  }
  let kOk = 0,
    kBad = 0;
  for (const [slot, key] of L.samples) {
    const i = origAt[slot];
    const orig = i < 0 ? null : Y.raw.subarray(Y.keyOff[i], Y.keyOff[i] + keyLen(Y, i));
    if (orig && Buffer.compare(orig, key) === 0) kOk++;
    else if (kBad++ < 3)
      console.log(`  키 다름: ${orig ? [...orig].join(",") : "-"} / ${[...key].join(",")}`);
  }
  console.log(`키 바이트 표본(97개마다): 같음 ${kOk} · 다름 ${kBad}`);
  bad += kBad;
  console.log(
    `대조: 같음 ${ok} · 다름/없음 ${bad} · 원시(비교 안 함) ${skipped} — ${bad ? "FAIL" : "OK"}`,
  );
  return bad === 0;
}

const [cmd, a, b, c] = process.argv.slice(2);
if (cmd === "convert") convert(a, b, Number(c ?? 9));
else if (cmd === "load") {
  const L = load(a);
  global.gc?.();
  const mu = process.memoryUsage();
  const tableBytes = L.tbl.a.byteLength + L.tbl.used.byteLength;
  console.log(
    JSON.stringify({
      nodes: L.nodes,
      loadMs: Math.round(L.ms),
      fileMB: +mb(L.fileLen),
      tableMB: +mb(tableBytes),
      texts: L.texts.size,
      rssMB: +mb(mu.rss),
      arrayBuffersMB: +mb(mu.arrayBuffers),
    }),
  );
} else if (cmd === "verify") process.exit(verify(a, b) ? 0 : 1);
else
  console.log(
    "사용: convert <in.db> <out.rydb> [level] | load <in.rydb> | verify <in.db> <in.rydb>",
  );
