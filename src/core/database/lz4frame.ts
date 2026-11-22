/**
 * LZ4 프레임 — 스트리밍 해제 · 압축(외부 의존 없음). yixindb 파일(`yxdbfile.ts`)의 바깥 껍질이다.
 *
 * 엔진(Rapfi `lz4_stream`, LZ4-HC)은 **64KB 연결 블록 + 내용 체크섬** 프레임을 쓴다(표본 FLG 0x44 · BD 0x40).
 * 해제기는 블록 하나씩 풀고, 연결 블록이면 앞 64KB 창만 남긴다 — 풀린 바이트(표본 700MB)를 통째로 들지 않는다
 * (라이브러리 계획 §4). 압축기는 **독립 블록**(기본 4MB) LZ4 fast 다 — 병합 · 분리 결과를 흘려 쓸 때.
 *
 * 형식: https://github.com/lz4/lz4/blob/dev/doc/lz4_Frame_format.md · lz4_Block_format.md
 */

export const LZ4_MAGIC = 0x184d2204;
const SKIPPABLE_MASK = 0xfffffff0;
const SKIPPABLE_MAGIC = 0x184d2a50;
const WINDOW = 64 * 1024;
/** BD 의 블록 최대 크기 번호 4..7 → 바이트. */
const BLOCK_MAX = [0, 0, 0, 0, 64 << 10, 256 << 10, 1 << 20, 4 << 20];

const u32 = (b: Uint8Array, p: number): number =>
  (b[p]! | (b[p + 1]! << 8) | (b[p + 2]! << 16) | (b[p + 3]! << 24)) >>> 0;

/** 앞 4바이트가 LZ4 프레임 매직인가. */
export const isLz4Frame = (head: Uint8Array): boolean =>
  head.length >= 4 && u32(head, 0) === LZ4_MAGIC;

// ── xxHash32 (프레임 머리 · 내용 체크섬) ───────────────────────────────

const P1 = 2654435761;
const P2 = 2246822519;
const P3 = 3266489917;
const P4 = 668265263;
const P5 = 374761393;
const rotl = (x: number, r: number): number => (x << r) | (x >>> (32 - r));
const round = (acc: number, w: number): number =>
  Math.imul(rotl((acc + Math.imul(w, P2)) | 0, 13), P1);

/** 스트리밍 xxHash32. */
export class Xxh32 {
  private v1: number;
  private v2: number;
  private v3: number;
  private v4: number;
  private total = 0;
  private readonly mem = new Uint8Array(16);
  private memLen = 0;

  constructor(private readonly seed = 0) {
    this.v1 = (seed + P1 + P2) | 0;
    this.v2 = (seed + P2) | 0;
    this.v3 = seed | 0;
    this.v4 = (seed - P1) | 0;
  }

  update(b: Uint8Array, off = 0, len = b.length - off): this {
    this.total += len;
    let p = off;
    const end = off + len;
    if (this.memLen > 0) {
      const take = Math.min(16 - this.memLen, len);
      this.mem.set(b.subarray(p, p + take), this.memLen);
      this.memLen += take;
      p += take;
      if (this.memLen < 16) return this;
      this.stripe(this.mem, 0);
      this.memLen = 0;
    }
    let { v1, v2, v3, v4 } = this;
    for (; p + 16 <= end; p += 16) {
      v1 = round(v1, u32(b, p));
      v2 = round(v2, u32(b, p + 4));
      v3 = round(v3, u32(b, p + 8));
      v4 = round(v4, u32(b, p + 12));
    }
    this.v1 = v1;
    this.v2 = v2;
    this.v3 = v3;
    this.v4 = v4;
    if (p < end) {
      this.mem.set(b.subarray(p, end), 0);
      this.memLen = end - p;
    }
    return this;
  }

  private stripe(b: Uint8Array, p: number): void {
    this.v1 = round(this.v1, u32(b, p));
    this.v2 = round(this.v2, u32(b, p + 4));
    this.v3 = round(this.v3, u32(b, p + 8));
    this.v4 = round(this.v4, u32(b, p + 12));
  }

  digest(): number {
    let h =
      this.total >= 16
        ? (rotl(this.v1, 1) + rotl(this.v2, 7) + rotl(this.v3, 12) + rotl(this.v4, 18)) | 0
        : (this.seed + P5) | 0;
    h = (h + this.total) | 0;
    const m = this.mem;
    let p = 0;
    for (; p + 4 <= this.memLen; p += 4)
      h = Math.imul(rotl((h + Math.imul(u32(m, p), P3)) | 0, 17), P4);
    for (; p < this.memLen; p++) h = Math.imul(rotl((h + Math.imul(m[p]!, P5)) | 0, 11), P1);
    h ^= h >>> 15;
    h = Math.imul(h, P2);
    h ^= h >>> 13;
    h = Math.imul(h, P3);
    h ^= h >>> 16;
    return h >>> 0;
  }
}

export const xxh32 = (b: Uint8Array, off = 0, len = b.length - off, seed = 0): number =>
  new Xxh32(seed).update(b, off, len).digest();

// ── 블록 해제 ───────────────────────────────────────────────────────

/**
 * LZ4 블록 하나를 `dst[dp..]` 에 푼다. 매치는 `dictStart` 까지 거슬러 갈 수 있다(연결 블록의 앞 창).
 * 새 끝 위치를 돌려준다. 망가진 블록이면 Error.
 */
export function lz4DecodeBlock(
  src: Uint8Array,
  sp: number,
  send: number,
  dst: Uint8Array,
  dp: number,
  dend: number,
  dictStart: number,
): number {
  for (;;) {
    if (sp >= send) throw new Error("LZ4: 블록이 토큰 없이 끝남");
    const tok = src[sp++]!;
    let lit = tok >>> 4;
    if (lit === 15) {
      let x: number;
      do {
        if (sp >= send) throw new Error("LZ4: 리터럴 길이가 잘림");
        lit += x = src[sp++]!;
      } while (x === 255);
    }
    if (sp + lit > send || dp + lit > dend) throw new Error("LZ4: 리터럴이 블록 밖");
    if (lit < 32) for (let i = 0; i < lit; i++) dst[dp++] = src[sp++]!;
    else {
      dst.set(src.subarray(sp, sp + lit), dp);
      sp += lit;
      dp += lit;
    }
    if (sp >= send) return dp; // 마지막 시퀀스는 리터럴만
    if (sp + 2 > send) throw new Error("LZ4: 오프셋이 잘림");
    const off = src[sp]! | (src[sp + 1]! << 8);
    sp += 2;
    let ml = tok & 15;
    if (ml === 15) {
      let x: number;
      do {
        if (sp >= send) throw new Error("LZ4: 매치 길이가 잘림");
        ml += x = src[sp++]!;
      } while (x === 255);
    }
    ml += 4;
    let s = dp - off;
    if (off === 0 || s < dictStart) throw new Error("LZ4: 잘못된 오프셋");
    if (dp + ml > dend) throw new Error("LZ4: 매치가 블록 밖");
    if (off >= ml && ml >= 32) {
      dst.copyWithin(dp, s, s + ml);
      dp += ml;
    } else for (let i = 0; i < ml; i++) dst[dp++] = dst[s++]!;
  }
}

// ── 스트리밍 프레임 해제 ─────────────────────────────────────────────

/** 풀린 바이트를 받는 쪽 — `buf[off..off+len)` 은 이 호출 동안만 유효하다(다음 블록이 덮어쓴다). */
export type Lz4Sink = (buf: Uint8Array, off: number, len: number) => void;

const enum St {
  Magic,
  FlgBd,
  HeadRest,
  BlockSize,
  Block,
  ContentChecksum,
  SkipSize,
  Skip,
}

export interface Lz4DecoderOptions {
  /** 내용 체크섬이 있으면 맞춰 본다(700MB 에 약 1초 더). 기본 꺼짐. */
  verify?: boolean;
}

/**
 * 조각으로 들어오는 LZ4 프레임(연속 프레임 · 건너뛸 프레임 포함)을 블록 단위로 풀어 `sink` 에 흘린다.
 * 들고 있는 메모리는 입력 블록 하나 + 출력 (64KB 창 + 블록 최대 크기) 뿐이다.
 */
export class Lz4FrameDecoder {
  private inBuf = new Uint8Array(1 << 16);
  private inLen = 0;
  private st = St.Magic;
  private need = 4;
  private flg = 0;
  private bd = 0;
  private blockMax = 0;
  private blockSize = 0;
  private blockRaw = false;
  private skipLeft = 0;
  private out = new Uint8Array(0);
  private outPos = 0;
  private hash: Xxh32 | null = null;
  private readonly verify: boolean;
  /** 지금까지 풀어 낸 바이트 수. */
  produced = 0;

  constructor(
    private readonly sink: Lz4Sink,
    opts: Lz4DecoderOptions = {},
  ) {
    this.verify = opts.verify ?? false;
  }

  push(chunk: Uint8Array): void {
    let p = 0;
    while (p < chunk.length) {
      if (this.st === St.Skip) {
        const k = Math.min(this.skipLeft, chunk.length - p);
        this.skipLeft -= k;
        p += k;
        if (this.skipLeft === 0) this.go(St.Magic, 4);
        continue;
      }
      const need = this.need;
      if (this.inLen === 0 && chunk.length - p >= need) {
        // 조각 안에 단위가 통째로 있으면 복사 없이
        p += need;
        this.unit(chunk, p - need);
        continue;
      }
      if (this.inBuf.length < need) {
        const nb = new Uint8Array(Math.max(need, this.inBuf.length * 2));
        nb.set(this.inBuf.subarray(0, this.inLen));
        this.inBuf = nb;
      }
      const take = Math.min(need - this.inLen, chunk.length - p);
      this.inBuf.set(chunk.subarray(p, p + take), this.inLen);
      this.inLen += take;
      p += take;
      if (this.inLen === need) {
        this.inLen = 0;
        this.unit(this.inBuf, 0);
      }
    }
  }

  /** 입력이 끝났다 — 프레임 경계가 아니면 잘린 파일이다. */
  end(): void {
    if (this.st === St.Magic && this.inLen === 0) return;
    throw new Error("LZ4: 파일이 잘림");
  }

  private go(st: St, need: number): void {
    this.st = st;
    this.need = need;
  }

  /** `b[p..p+need)` 한 단위를 처리하고 다음 상태로. */
  private unit(b: Uint8Array, p: number): void {
    switch (this.st) {
      case St.Magic: {
        const m = u32(b, p);
        if (m === LZ4_MAGIC) return this.go(St.FlgBd, 2);
        if ((m & SKIPPABLE_MASK) >>> 0 === SKIPPABLE_MAGIC) return this.go(St.SkipSize, 4);
        throw new Error("LZ4: 프레임 매직이 아님");
      }
      case St.SkipSize:
        this.skipLeft = u32(b, p);
        if (this.skipLeft === 0) return this.go(St.Magic, 4);
        return this.go(St.Skip, 0);
      case St.FlgBd: {
        const flg = b[p]!;
        if (flg >>> 6 !== 1) throw new Error("LZ4: 모르는 프레임 판");
        this.flg = flg;
        this.bd = b[p + 1]!;
        return this.go(St.HeadRest, (flg & 8 ? 8 : 0) + (flg & 1 ? 4 : 0) + 1);
      }
      case St.HeadRest: {
        const n = this.need;
        const h = new Uint8Array(1 + n);
        h[0] = this.flg;
        h[1] = this.bd;
        h.set(b.subarray(p, p + n - 1), 2);
        if (((xxh32(h, 0, n + 1) >>> 8) & 0xff) !== b[p + n - 1])
          throw new Error("LZ4: 머리 체크섬이 맞지 않음");
        const max = BLOCK_MAX[(this.bd >>> 4) & 7] ?? 0;
        if (!max) throw new Error("LZ4: 모르는 블록 크기");
        this.blockMax = max;
        const size = (this.linked ? WINDOW : 0) + max;
        if (this.out.length < size) this.out = new Uint8Array(size);
        this.outPos = 0;
        this.hash = this.verify && this.flg & 4 ? new Xxh32() : null;
        return this.go(St.BlockSize, 4);
      }
      case St.BlockSize: {
        const bs = u32(b, p);
        if (bs === 0) return this.flg & 4 ? this.go(St.ContentChecksum, 4) : this.go(St.Magic, 4);
        this.blockRaw = (bs & 0x80000000) !== 0;
        this.blockSize = bs & 0x7fffffff;
        if (this.blockSize > this.blockMax) throw new Error("LZ4: 블록이 최대 크기보다 큼");
        return this.go(St.Block, this.blockSize + (this.flg & 16 ? 4 : 0));
      }
      case St.Block:
        this.block(b, p);
        return this.go(St.BlockSize, 4);
      case St.ContentChecksum:
        if (this.hash && this.hash.digest() !== u32(b, p))
          throw new Error("LZ4: 내용 체크섬이 맞지 않음");
        return this.go(St.Magic, 4);
      default:
        throw new Error("LZ4: 상태 오류");
    }
  }

  private get linked(): boolean {
    return (this.flg & 0x20) === 0;
  }

  private block(b: Uint8Array, p: number): void {
    const linked = this.linked;
    const out = this.out;
    let start = 0;
    if (linked) {
      // 창: 직전 64KB 만 남기고 앞으로 민다
      if (this.outPos + this.blockMax > out.length) {
        const keep = Math.min(WINDOW, this.outPos);
        out.copyWithin(0, this.outPos - keep, this.outPos);
        this.outPos = keep;
      }
      start = this.outPos;
    }
    let end: number;
    if (this.blockRaw) {
      out.set(b.subarray(p, p + this.blockSize), start);
      end = start + this.blockSize;
    } else
      end = lz4DecodeBlock(
        b,
        p,
        p + this.blockSize,
        out,
        start,
        start + this.blockMax,
        linked ? 0 : start,
      );
    this.outPos = end;
    const len = end - start;
    this.produced += len;
    this.hash?.update(out, start, len);
    this.sink(out, start, len);
  }
}

// ── 블록 압축 (LZ4 fast) ─────────────────────────────────────────────

const MINMATCH = 4;
const LASTLITERALS = 5;
const MFLIMIT = 12;
const HASH_BITS = 16;
const MAX_OFFSET = 65535;

/** 압축 결과가 들어갈 최대 크기. */
export const lz4CompressBound = (n: number): number => n + ((n / 255) | 0) + 16;

/**
 * `src[s0..s0+len)` 를 LZ4 블록으로 `dst[d0..]` 에 압축하고 길이를 돌려준다. `table` 은
 * `Int32Array(1 << 16)` 재사용 버퍼. dst 는 `lz4CompressBound(len)` 이상 남아 있어야 한다.
 */
export function lz4CompressBlock(
  src: Uint8Array,
  s0: number,
  len: number,
  dst: Uint8Array,
  d0: number,
  table: Int32Array,
): number {
  const end = s0 + len;
  let op = d0;
  let anchor = s0;
  if (len >= MFLIMIT + 1) {
    table.fill(-1);
    const mflimit = end - MFLIMIT;
    const matchlimit = end - LASTLITERALS;
    const read32 = (i: number) =>
      src[i]! | (src[i + 1]! << 8) | (src[i + 2]! << 16) | (src[i + 3]! << 24);
    const hash = (v: number) => Math.imul(v, P1) >>> (32 - HASH_BITS);
    let ip = s0 + 1;
    table[hash(read32(s0))] = s0;
    outer: for (;;) {
      // 매치 찾기 — 못 찾을수록 보폭을 넓힌다(LZ4 의 가속)
      let ref: number;
      let attempts = 1 << 6;
      for (;;) {
        if (ip >= mflimit) break outer;
        const seq = read32(ip);
        const h = hash(seq);
        ref = table[h]!;
        table[h] = ip;
        if (ref >= s0 && ip - ref <= MAX_OFFSET && read32(ref) === seq) break;
        ip += attempts++ >>> 6;
      }
      // 뒤로 늘리기
      while (ip > anchor && ref > s0 && src[ip - 1] === src[ref - 1]) {
        ip--;
        ref--;
      }
      // 앞으로 늘리기
      let ml = MINMATCH;
      while (ip + ml < matchlimit && src[ip + ml] === src[ref + ml]) ml++;
      // 시퀀스 쓰기
      const lit = ip - anchor;
      const tok = op++;
      if (lit >= 15) {
        dst[tok] = 0xf0;
        let l = lit - 15;
        for (; l >= 255; l -= 255) dst[op++] = 255;
        dst[op++] = l;
      } else dst[tok] = lit << 4;
      if (lit < 32) for (let i = 0; i < lit; i++) dst[op++] = src[anchor + i]!;
      else {
        dst.set(src.subarray(anchor, ip), op);
        op += lit;
      }
      const off = ip - ref;
      dst[op++] = off & 0xff;
      dst[op++] = off >>> 8;
      let mcode = ml - MINMATCH;
      if (mcode >= 15) {
        dst[tok]! |= 15;
        mcode -= 15;
        for (; mcode >= 255; mcode -= 255) dst[op++] = 255;
        dst[op++] = mcode;
      } else dst[tok]! |= mcode;
      ip += ml;
      anchor = ip;
      if (ip >= mflimit) break;
      table[hash(read32(ip - 2))] = ip - 2;
    }
  }
  // 마지막 리터럴
  const lit = end - anchor;
  const tok = op++;
  if (lit >= 15) {
    dst[tok] = 0xf0;
    let l = lit - 15;
    for (; l >= 255; l -= 255) dst[op++] = 255;
    dst[op++] = l;
  } else dst[tok] = lit << 4;
  dst.set(src.subarray(anchor, end), op);
  op += lit;
  return op - d0;
}

/** 압축 결과 조각을 받는 쪽 — 조각은 받는 쪽 소유다(다시 쓰지 않는다). */
export type Lz4ChunkSink = (chunk: Uint8Array) => void;

/**
 * LZ4 프레임 압축기 — 독립 블록, 블록 체크섬 없음, 내용 체크섬 있음. `write` 로 흘려 넣고 `finish`.
 * 들고 있는 메모리는 블록 하나 + 압축 버퍼 하나.
 */
export class Lz4FrameEncoder {
  private readonly blockSize: number;
  private readonly bdId: number;
  private readonly buf: Uint8Array;
  private bufLen = 0;
  private readonly table = new Int32Array(1 << HASH_BITS);
  private readonly hash = new Xxh32();
  private started = false;
  /** 내보낸 압축 바이트 수. */
  written = 0;

  constructor(
    private readonly sink: Lz4ChunkSink,
    blockSize: 64 | 256 | 1024 | 4096 = 4096,
  ) {
    this.blockSize = blockSize * 1024;
    this.bdId = BLOCK_MAX.indexOf(this.blockSize);
    this.buf = new Uint8Array(this.blockSize);
  }

  private emit(chunk: Uint8Array): void {
    this.written += chunk.length;
    this.sink(chunk);
  }

  private header(): void {
    this.started = true;
    const h = new Uint8Array(7);
    const dv = new DataView(h.buffer);
    dv.setUint32(0, LZ4_MAGIC, true);
    h[4] = 0x40 | 0x20 | 0x04; // 판 01 · 독립 블록 · 내용 체크섬
    h[5] = this.bdId << 4;
    h[6] = (xxh32(h, 4, 2) >>> 8) & 0xff;
    this.emit(h);
  }

  write(src: Uint8Array, off = 0, len = src.length - off): void {
    if (!this.started) this.header();
    this.hash.update(src, off, len);
    let p = off;
    const end = off + len;
    while (p < end) {
      const take = Math.min(this.blockSize - this.bufLen, end - p);
      this.buf.set(src.subarray(p, p + take), this.bufLen);
      this.bufLen += take;
      p += take;
      if (this.bufLen === this.blockSize) this.flushBlock();
    }
  }

  private flushBlock(): void {
    const n = this.bufLen;
    if (n === 0) return;
    const out = new Uint8Array(4 + lz4CompressBound(n));
    const c = lz4CompressBlock(this.buf, 0, n, out, 4, this.table);
    const dv = new DataView(out.buffer);
    if (c >= n) {
      dv.setUint32(0, (n | 0x80000000) >>> 0, true);
      out.set(this.buf.subarray(0, n), 4);
      this.emit(out.subarray(0, 4 + n));
    } else {
      dv.setUint32(0, c, true);
      this.emit(out.subarray(0, 4 + c));
    }
    this.bufLen = 0;
  }

  finish(): void {
    if (!this.started) this.header();
    this.flushBlock();
    const tail = new Uint8Array(8);
    const dv = new DataView(tail.buffer);
    dv.setUint32(0, 0, true);
    dv.setUint32(4, this.hash.digest(), true);
    this.emit(tail);
  }
}
