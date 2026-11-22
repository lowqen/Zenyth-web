import { isLz4Frame, Lz4FrameDecoder, Lz4FrameEncoder } from "./lz4frame";

/**
 * yixindb 파일 — 스트리밍 코덱(라이브러리 계획 §4 L0). 엔진 없이 워커에서 파일을 읽고 쓴다.
 *
 * ```
 * [LZ4 프레임(선택)] u32 레코드 수 · (u16 키 길이 · 키 · u16 값 길이 · 값) × 레코드 수
 * 키 = rule(1) · 너비(1) · 높이(1) · (x, y) × 돌      — 흑 ceil(n/2) 칸 다음 백 floor(n/2) 칸
 * 값 = label(1) · value(i16) · depthbound(i16) · 글(UTF-8)   — 길이 0 이면 «기록 없음»
 * ```
 *
 * - 첫 레코드는 너비 · 높이가 0 인 메타데이터(`charset="UTF-8"`).
 * - 칸이 (-1, -1) 이면 패스 — 그 구역의 끝이고 돌로 세지 않는다(둘 차례가 뒤집힌 국면).
 * - 엔진(db5)은 `(rule, 너비, 높이, 돌 수, 돌 바이트, 둘 차례)` 순서로 쓴다(`compareEntry`) — **돌 수가 먼저**라
 *   부모(돌 하나 적은 국면)가 늘 자식보다 앞선다. `compareYxdbKeys` 가 같은 순서다.
 *
 * 풀린 바이트를 통째로 들지 않는다 — 레코드는 해제기 블록 위에서 바로 읽고, 블록 경계에 걸친 레코드만 작은
 * 이월 버퍼(≤ 128KB)로 옮긴다.
 */

/** 레코드 하나 — `buf` 의 바이트는 이 호출 동안만 유효하다. 다음 레코드부터 받지 않으려면 false. */
export type YxdbRecordFn = (
  buf: Uint8Array,
  keyOff: number,
  keyLen: number,
  valOff: number,
  valLen: number,
  index: number,
) => void | boolean;

const MAX_RECORD = 2 + 0xffff + 2 + 0xffff;

/**
 * 조각으로 들어오는 풀린 바이트를 레코드로 자른다. 머리의 레코드 수만큼 읽고 멈춘다(엔진 로더와 같다) —
 * 그 뒤에 남은 바이트는 `trailing` 에 센다.
 */
export class YxdbRecordParser {
  /** 머리의 레코드 수(머리를 읽기 전엔 -1). */
  count = -1;
  /** 읽은 레코드 수(키 길이 0 인 칸도 센다 — 번호는 파일 순서). */
  index = 0;
  /** 레코드 수만큼 읽은 뒤 남은 바이트. */
  trailing = 0;
  /** 받는 쪽이 false 를 돌려 멈췄다. */
  stopped = false;
  private readonly carry = new Uint8Array(MAX_RECORD);
  private carryLen = 0;

  constructor(
    private readonly onRecord: YxdbRecordFn,
    private readonly onCount?: (count: number) => void,
  ) {}

  get done(): boolean {
    return this.stopped || (this.count >= 0 && this.index >= this.count);
  }

  push(buf: Uint8Array, off: number, len: number): void {
    let p = off;
    const end = off + len;
    if (this.done) {
      if (!this.stopped) this.trailing += len;
      return;
    }
    // 이월분이 있으면 그 레코드를 먼저 채운다
    if (this.carryLen > 0) {
      // 길이 머리를 다 읽을 때마다 필요한 양이 늘 수 있다 — 더 늘지 않을 때까지
      for (;;) {
        const want = this.wanted(this.carry, 0, this.carryLen);
        if (this.carryLen >= want) break;
        if (p >= end) return;
        const take = Math.min(want - this.carryLen, end - p);
        this.carry.set(buf.subarray(p, p + take), this.carryLen);
        this.carryLen += take;
        p += take;
      }
      const used = this.consume(this.carry, 0, this.carryLen);
      if (used !== this.carryLen) throw new Error("yixindb: 이월 버퍼 오류");
      this.carryLen = 0;
      if (this.done) {
        if (!this.stopped) this.trailing += end - p;
        return;
      }
    }
    while (p < end) {
      const want = this.wanted(buf, p, end - p);
      if (end - p < want) {
        this.carry.set(buf.subarray(p, end), 0);
        this.carryLen = end - p;
        return;
      }
      p += this.consume(buf, p, end - p);
      if (this.done) {
        if (!this.stopped) this.trailing += end - p;
        return;
      }
    }
  }

  /** 다음 단위(머리 4바이트 또는 레코드 하나)를 다 읽으려면 필요한 바이트 수 — 아는 만큼. */
  private wanted(b: Uint8Array, p: number, avail: number): number {
    if (this.count < 0) return 4;
    if (avail < 2) return 2;
    const kl = b[p]! | (b[p + 1]! << 8);
    if (kl === 0) return 2; // 로더도 건너뛴다(값 칸 없음)
    if (avail < 2 + kl + 2) return 2 + kl + 2;
    return 2 + kl + 2 + (b[p + 2 + kl]! | (b[p + 3 + kl]! << 8));
  }

  /** 다 모인 단위 하나를 읽고 쓴 바이트 수를 돌려준다. */
  private consume(b: Uint8Array, p: number, _avail: number): number {
    if (this.count < 0) {
      this.count = (b[p]! | (b[p + 1]! << 8) | (b[p + 2]! << 16) | (b[p + 3]! << 24)) >>> 0;
      this.onCount?.(this.count);
      return 4;
    }
    const kl = b[p]! | (b[p + 1]! << 8);
    const i = this.index++;
    if (kl === 0) return 2;
    const vl = b[p + 2 + kl]! | (b[p + 3 + kl]! << 8);
    if (this.onRecord(b, p + 2, kl, p + 4 + kl, vl, i) === false) this.stopped = true;
    return 4 + kl + vl;
  }

  /** 입력이 끝났다 — 레코드 수만큼 못 읽었으면 잘린 파일이다. */
  end(): void {
    if (this.stopped) return;
    if (this.count < 0) throw new Error("yixindb: 레코드 수 머리가 없음");
    if (this.index < this.count)
      throw new Error(`yixindb: 레코드 ${this.index}/${this.count} 에서 잘림`);
  }
}

// ── 스트림 읽기 ─────────────────────────────────────────────────────

export interface ReadYxdbOptions {
  /** LZ4 내용 체크섬을 맞춰 본다(기본 꺼짐). */
  verify?: boolean;
  /** 조각마다 — 읽은 (압축) 바이트 · 전체. */
  onChunk?: (loaded: number, total: number) => void;
  /** 조각마다 묻는다 — true 면 `YxdbCancelled` 를 던진다. */
  isCancelled?: () => boolean;
  /** 머리의 레코드 수를 읽었을 때(첫 레코드 전). */
  onCount?: (count: number) => void;
}

export interface ReadYxdbResult {
  /** 머리의 레코드 수. */
  count: number;
  /** 읽은 레코드 수(멈췄으면 그때까지). */
  read: number;
  compressed: boolean;
  /** 풀린 바이트 수(멈췄으면 그때까지). */
  rawBytes: number;
  trailing: number;
  stopped: boolean;
}

export class YxdbCancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "YxdbCancelled";
  }
}

/** 브라우저 `Blob`/`File` 이든 node `fs.openAsBlob` 이든 — `stream()` 과 `size` 만 쓴다. */
export interface BlobLike {
  readonly size: number;
  stream(): ReadableStream<Uint8Array>;
}

/**
 * 파일을 처음부터 흘려 읽으며 레코드마다 `onRecord`. LZ4 프레임이면 풀고, 아니면(압축 안 한 yixindb) 그대로.
 * `onRecord` 가 false 를 돌려주면 그 자리에서 읽기를 멈춘다.
 */
export async function readYxdb(
  blob: BlobLike,
  onRecord: YxdbRecordFn,
  opts: ReadYxdbOptions = {},
): Promise<ReadYxdbResult> {
  const parser = new YxdbRecordParser(onRecord, opts.onCount);
  let rawBytes = 0;
  const feed = (b: Uint8Array, off: number, len: number) => {
    rawBytes += len;
    parser.push(b, off, len);
  };
  let decoder: Lz4FrameDecoder | null = null;
  let decided = false;
  let head = new Uint8Array(0);
  const reader = blob.stream().getReader();
  let loaded = 0;
  try {
    for (;;) {
      if (opts.isCancelled?.()) throw new YxdbCancelled();
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      let chunk = value;
      if (!decided) {
        // 앞 4바이트로 압축 여부를 가른다(첫 조각이 4바이트보다 짧을 수도 있다)
        const h = new Uint8Array(head.length + chunk.length);
        h.set(head);
        h.set(chunk, head.length);
        if (h.length < 4) {
          head = h;
          continue;
        }
        decided = true;
        chunk = h;
        if (isLz4Frame(h)) decoder = new Lz4FrameDecoder(feed, opts.verify ? { verify: true } : {});
      }
      if (decoder) decoder.push(chunk);
      else feed(chunk, 0, chunk.length);
      opts.onChunk?.(loaded, blob.size);
      if (parser.stopped) break;
    }
    if (!parser.stopped) {
      if (!decided && head.length > 0) feed(head, 0, head.length);
      decoder?.end();
      parser.end();
    }
  } finally {
    if (parser.stopped || opts.isCancelled?.()) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return {
    count: parser.count,
    read: parser.index,
    compressed: decoder !== null,
    rawBytes,
    trailing: parser.trailing,
    stopped: parser.stopped,
  };
}

// ── 키 · 값 ─────────────────────────────────────────────────────────

export const RULE_FREESTYLE = 0;
export const RULE_STANDARD = 1;
export const RULE_RENJU = 2;
const RULE_NAMES = ["freestyle", "standard", "renju"];

/** 통계 열쇠 — `renju-15`, 정사각이 아니면 `renju-15x20`. */
export function ruleBoardName(rule: number, w: number, h: number): string {
  const r = RULE_NAMES[rule] ?? `rule${rule}`;
  return w === h ? `${r}-${w}` : `${r}-${w}x${h}`;
}

/** 메타데이터 레코드(너비 · 높이 0)인가. */
export const isMetaKey = (b: Uint8Array, keyOff: number, keyLen: number): boolean =>
  keyLen >= 3 && b[keyOff + 1] === 0 && b[keyOff + 2] === 0;

/**
 * 키에서 실제 돌 수 — 패스 칸은 세지 않는다. 키가 엔진 로더 기준으로 이상하면(범위 밖 좌표) -1.
 */
export function keyStoneCount(b: Uint8Array, keyOff: number, keyLen: number): number {
  if (keyLen < 3) return -1;
  const w = b[keyOff + 1]!;
  const h = b[keyOff + 2]!;
  const slots = (keyLen - 3) >> 1;
  const nb = (slots + 1) >> 1;
  let n = 0;
  for (let c = 0; c < 2; c++) {
    const begin = c === 0 ? 0 : nb;
    const cnt = c === 0 ? nb : slots - nb;
    for (let i = 0; i < cnt; i++) {
      const x = b[keyOff + 3 + 2 * (begin + i)]!;
      const y = b[keyOff + 4 + 2 * (begin + i)]!;
      if (x === 0xff && y === 0xff) break;
      if (x >= w || y >= h) return -1;
      n++;
    }
  }
  return n;
}

/**
 * 엔진 키 순서(db5 `compareEntry`): rule · 너비 · 높이 · 돌 수 · 돌 바이트(부호 없는 memcmp) · 둘 차례.
 * 둘 차례는 패스 칸이 있을 때만 다르다 — 칸 수의 홀짝으로 본다.
 */
export function compareYxdbKeys(
  a: Uint8Array,
  ao: number,
  al: number,
  b: Uint8Array,
  bo: number,
  bl: number,
): number {
  for (let i = 0; i < 3; i++) {
    const d = (a[ao + i] ?? 0) - (b[bo + i] ?? 0);
    if (d !== 0) return d;
  }
  if (!hasPassSlot(a, ao, al) && !hasPassSlot(b, bo, bl)) {
    // 패스 칸 없음(거의 늘) — 돌 수 = 칸 수, 같으면 바이트 그대로
    if (al !== bl) return al - bl;
    for (let i = 3; i < al; i++) if (a[ao + i] !== b[bo + i]) return a[ao + i]! - b[bo + i]!;
    return 0;
  }
  const na = keyStoneCount(a, ao, al);
  const nb = keyStoneCount(b, bo, bl);
  if (na !== nb) return na - nb;
  // 돌 바이트: 패스 칸을 뺀 돌만 순서대로
  const sa = stoneBytes(a, ao, al);
  const sb = stoneBytes(b, bo, bl);
  for (let i = 0; i < sa.length && i < sb.length; i++) if (sa[i] !== sb[i]) return sa[i]! - sb[i]!;
  // 둘 차례: 흑 = 0, 백 = 1 — 칸 수가 짝수면 흑 차례
  const stmA = ((al - 3) >> 1) % 2;
  const stmB = ((bl - 3) >> 1) % 2;
  return stmA - stmB;
}

/** 패스 칸은 구역 끝에만 온다(엔진 `putRecord`) — 흑 구역 끝 · 백 구역 끝 두 칸만 본다. */
function hasPassSlot(b: Uint8Array, o: number, l: number): boolean {
  const slots = (l - 3) >> 1;
  if (slots === 0) return false;
  const nb = (slots + 1) >> 1;
  const pb = o + 3 + 2 * (nb - 1);
  const pw = o + 3 + 2 * (slots - 1);
  return (b[pb] === 0xff && b[pb + 1] === 0xff) || (b[pw] === 0xff && b[pw + 1] === 0xff);
}

function stoneBytes(b: Uint8Array, o: number, l: number): number[] {
  const slots = (l - 3) >> 1;
  const nb = (slots + 1) >> 1;
  const out: number[] = [];
  for (let c = 0; c < 2; c++) {
    const begin = c === 0 ? 0 : nb;
    const cnt = c === 0 ? nb : slots - nb;
    for (let i = 0; i < cnt; i++) {
      const x = b[o + 3 + 2 * (begin + i)]!;
      const y = b[o + 4 + 2 * (begin + i)]!;
      if (x === 0xff && y === 0xff) break;
      out.push(x, y);
    }
  }
  return out;
}

/** 값의 라벨 바이트(기록 없음이면 0). 엔진은 `w` `l` `d` 소문자로 적는다. */
export const valueLabel = (b: Uint8Array, valOff: number, valLen: number): number =>
  valLen > 0 ? b[valOff]! : 0;

/** 값의 글 길이(UTF-8 바이트). */
export const valueTextLength = (valLen: number): number => (valLen > 5 ? valLen - 5 : 0);

// ── 쓰기 ───────────────────────────────────────────────────────────

export interface YxdbWriterOptions {
  /** LZ4 프레임으로 감싼다(기본 켬 — 엔진 `compressed_save` 기본과 같다). */
  compress?: boolean;
  /** LZ4 블록 크기(KB). 기본 4096. */
  blockKB?: 64 | 256 | 1024 | 4096;
}

/**
 * yixindb 를 흘려 쓴다. 레코드 수는 머리에 먼저 적으므로 미리 알아야 한다(병합 · 분리는 미리 보기에서 센다).
 * 들고 있는 메모리는 1MB 쓰기 버퍼 + LZ4 블록 하나.
 */
export class YxdbWriter {
  private readonly enc: Lz4FrameEncoder | null;
  private readonly buf = new Uint8Array(1 << 20);
  private len = 0;
  private written = 0;
  private finished = false;

  constructor(
    private readonly count: number,
    private readonly sink: (chunk: Uint8Array) => void,
    opts: YxdbWriterOptions = {},
  ) {
    this.enc = (opts.compress ?? true) ? new Lz4FrameEncoder(sink, opts.blockKB ?? 4096) : null;
    const h = new Uint8Array(4);
    new DataView(h.buffer).setUint32(0, count >>> 0, true);
    this.put(h, 0, 4);
  }

  /** 받은 레코드 수. */
  get records(): number {
    return this.written;
  }

  /** 출력된 바이트 수(압축 뒤). 쓰기 버퍼에 남은 것은 아직 세지 않는다. */
  get outBytes(): number {
    return this.enc ? this.enc.written : this.flushed;
  }
  private flushed = 0;

  private flush(): void {
    if (this.len === 0) return;
    if (this.enc) this.enc.write(this.buf, 0, this.len);
    else {
      this.sink(this.buf.slice(0, this.len));
      this.flushed += this.len;
    }
    this.len = 0;
  }

  private put(b: Uint8Array, off: number, n: number): void {
    if (this.len + n > this.buf.length) {
      this.flush();
      if (n > this.buf.length) {
        if (this.enc) this.enc.write(b, off, n);
        else {
          this.sink(b.slice(off, off + n));
          this.flushed += n;
        }
        return;
      }
    }
    this.buf.set(b.subarray(off, off + n), this.len);
    this.len += n;
  }

  private u16(v: number): void {
    if (this.len + 2 > this.buf.length) this.flush();
    this.buf[this.len++] = v & 0xff;
    this.buf[this.len++] = (v >>> 8) & 0xff;
  }

  /** 레코드 하나 — 읽은 레코드를 그대로 옮길 때(`readYxdb` 의 인자 모양). */
  record(b: Uint8Array, keyOff: number, keyLen: number, valOff: number, valLen: number): void {
    if (this.finished) throw new Error("yixindb: 이미 닫힘");
    if (keyLen < 3 || keyLen > 0xffff || valLen > 0xffff) throw new Error("yixindb: 레코드 길이");
    this.u16(keyLen);
    this.put(b, keyOff, keyLen);
    this.u16(valLen);
    this.put(b, valOff, valLen);
    this.written++;
  }

  finish(): void {
    if (this.finished) return;
    if (this.written !== this.count)
      throw new Error(`yixindb: 레코드 수가 머리와 다름(${this.written} ≠ ${this.count})`);
    this.flush();
    this.enc?.finish();
    this.finished = true;
  }
}

/** 메타데이터 레코드 — 엔진이 맨 앞에 쓰는 것과 같은 바이트(`charset="UTF-8"`). */
export function metaRecord(): { key: Uint8Array; value: Uint8Array } {
  const text = new TextEncoder().encode('charset="UTF-8"');
  const value = new Uint8Array(5 + text.length);
  value.set(text, 5);
  return { key: new Uint8Array([0, 0, 0]), value };
}
