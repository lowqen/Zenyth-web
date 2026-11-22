import { move, type Move } from "../model/move";

/**
 * yixindb 키 — 대칭 정규화 · 대칭 Zobrist · 부모 국면. RYDB PoC(`bench/dbio/rydb-poc.mjs`, engineering-notes §10)를
 * `core/` 로 옮긴 것이다. 라이브러리 색인(`yxdbindex.ts`)이 키 바이트를 들지 않고 국면을 찾는 데 쓴다.
 *
 * - **변환 번호**는 엔진 `applyTransform`(pos.h) 순서: IDENTITY, ROTATE_90, 180, 270, FLIP_X, FLIP_Y, FLIP_XY, FLIP_YX.
 * - **정규 키**(엔진 `toSmallestDBKey`): 8 변환 가운데 (흑 정렬, 백 정렬) 돌 바이트가 가장 작은 것.
 * - **대칭 해시**: 8 변환의 Zobrist 값 중 최솟값(64비트 = 32비트 둘) — 어느 좌표계에서 세어도 같다. 돌 하나를
 *   더하고 빼는 것이 XOR 이라 부모 후보의 해시를 키를 다시 만들지 않고 얻는다.
 * - Zobrist 값은 splitmix64 에서 뽑는다 — xorshift 같은 선형 생성기의 출력은 XOR 하면 32차원에 갇혀 돌 수가 다른
 *   국면끼리도 충돌한다(PoC 첫 시도에서 실제로 났다).
 *
 * 칸 = `(x << 5) | y` (32줄까지). 크기 순서가 (x, y) 바이트 memcmp 순서와 같다.
 */

export const MAX_BOARD = 32;
const CELLS = MAX_BOARD * MAX_BOARD;

// ── Zobrist ────────────────────────────────────────────────────────

// Int32Array — V8 에서 2³¹ 넘는 Uint32 값은 double 로 읽혀 해시 루프가 몇 배 느려진다. 순서(최솟값)는 부호 있는
// 비교로 정한다 — 어떤 전순서든 일관되기만 하면 된다.
const ZH = new Int32Array(2 * CELLS);
const ZL = new Int32Array(2 * CELLS);
{
  const M = (1n << 64n) - 1n;
  let s = 0x5a454e595448n; // "ZENYTH"
  for (let i = 0; i < ZH.length; i++) {
    s = (s + 0x9e3779b97f4a7c15n) & M;
    let z = s;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M;
    z ^= z >> 31n;
    ZH[i] = Number(BigInt.asIntN(32, z >> 32n));
    ZL[i] = Number(BigInt.asIntN(32, z));
  }
}

/** 변환 t 로 (x, y) 를 옮긴다 — s = 판 크기 - 1. */
export function transform(t: number, x: number, y: number, s: number): [number, number] {
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

const TX = new Map<number, Uint16Array>();
/** 판 크기 w 의 변환표: `T[t * 1024 + 칸]` = 옮긴 칸. */
function txTable(w: number): Uint16Array {
  let t = TX.get(w);
  if (t) return t;
  t = new Uint16Array(8 * CELLS);
  const s = w - 1;
  for (let k = 0; k < 8; k++)
    for (let x = 0; x < w; x++)
      for (let y = 0; y < w; y++) {
        const [X, Y] = transform(k, x, y, s);
        t[k * CELLS + ((x << 5) | y)] = (X << 5) | Y;
      }
  TX.set(w, t);
  return t;
}

const ZROWS = new Map<number, Int32Array>();
/**
 * 판 크기 w 의 해시 행: `R[(색 * 1024 + 칸) * 16 + 2t (+1)]` = 변환 t 로 옮긴 칸의 Zobrist 상위(하위). 한 돌을 더하는
 * 일이 연속 16개 XOR 가 된다(변환표 · Zobrist 표를 따로 찾아가면 몇 배 느렸다). 판 크기마다 128KB.
 */
function zRows(w: number): Int32Array {
  let r = ZROWS.get(w);
  if (r) return r;
  const T = txTable(w);
  r = new Int32Array(2 * CELLS * 16);
  for (let c = 0; c < 2; c++)
    for (let x = 0; x < w; x++)
      for (let y = 0; y < w; y++) {
        const cell = (x << 5) | y;
        const o = (c * CELLS + cell) * 16;
        for (let t = 0; t < 8; t++) {
          const q = c * CELLS + T[t * CELLS + cell]!;
          r[o + 2 * t] = ZH[q]!;
          r[o + 2 * t + 1] = ZL[q]!;
        }
      }
  ZROWS.set(w, r);
  return r;
}

// ── 키 해시 ─────────────────────────────────────────────────────────

/**
 * 키 하나를 읽어 8 변환 해시를 들고, 정규 해시 · 부모 후보 해시를 낸다. 할당 없이 재사용한다.
 * 결과는 `hi` · `lo` 에(부호 있는 32비트 — 순서도 부호 있는 비교).
 */
export class KeyHasher {
  /** 8 변환의 해시 — `vec[2t]` 상위, `vec[2t + 1]` 하위. */
  readonly vec = new Int32Array(16);
  /** 칸 `(x << 5) | y` — 흑 `nb` 개 다음 백. */
  readonly cells = new Uint16Array(CELLS);
  n = 0;
  nb = 0;
  rule = 0;
  w = 0;
  hi = 0;
  lo = 0;
  private rows: Int32Array = zRows(15);
  /**
   * 접두 해시 — `pre[i * 16 ..]` = 앞 돌 i 개의 8 변환 해시. 파일은 키 순서라 이웃 레코드가 앞 돌을 많이 공유한다
   * (표본: 평균 37돌 중 24돌) — 공통 접두 뒤만 다시 센다. `preValid` 개까지 지금 `cells` 에 맞다.
   */
  private readonly pre = new Int32Array((CELLS + 1) * 16);
  private preValid = 0;

  /**
   * 키를 읽는다. 해시할 수 있는 키(정사각 · 1..32줄 · 패스 칸 없음 · 좌표가 판 안)면 true. 메타데이터 ·
   * 패스 칸 · 직사각 판은 false — 색인에서 «특수» 레코드로 다룬다. 해시는 `hash()` 를 따로 부른다.
   */
  load(b: Uint8Array, off: number, len: number): boolean {
    if (len < 3 || (len - 3) & 1) return false;
    const w = b[off + 1]!;
    if (w === 0 || w > MAX_BOARD || b[off + 2] !== w) return false;
    const n = (len - 3) >> 1;
    const cells = this.cells;
    let lcp = w === this.w ? this.preValid : 0;
    for (let i = 0, p = off + 3; i < n; i++, p += 2) {
      const x = b[p]!;
      const y = b[p + 1]!;
      if (x >= w || y >= w) {
        this.preValid = 0; // cells 를 덮어쓰다 말았다
        return false; // 패스 칸(0xFF)도 여기서 걸린다
      }
      const c = (x << 5) | y;
      if (i < lcp && cells[i] !== c) lcp = i;
      cells[i] = c;
    }
    const nb = (n + 1) >> 1;
    if (lcp > n) lcp = n;
    // 색은 «i < nb» 로 정해진다 — nb 가 바뀌면 둘 다 흑인 앞부분까지만 맞다
    if (nb !== this.nb) lcp = Math.min(lcp, nb, this.nb);
    this.preValid = lcp;
    if (w !== this.w) {
      this.rows = zRows(w);
      this.w = w;
    }
    this.rule = b[off]!;
    this.n = n;
    this.nb = nb;
    return true;
  }

  /** 읽은 키의 8 변환 해시를 `vec` 에 채운다. */
  hash(): void {
    const R = this.rows;
    const cells = this.cells;
    const pre = this.pre;
    const n = this.n;
    const nb = this.nb;
    let i = this.preValid;
    let o = i * 16;
    for (; i < n; i++) {
      const z = ((i < nb ? 0 : CELLS) + cells[i]!) * 16;
      const d = o + 16;
      pre[d] = pre[o]! ^ R[z]!;
      pre[d + 1] = pre[o + 1]! ^ R[z + 1]!;
      pre[d + 2] = pre[o + 2]! ^ R[z + 2]!;
      pre[d + 3] = pre[o + 3]! ^ R[z + 3]!;
      pre[d + 4] = pre[o + 4]! ^ R[z + 4]!;
      pre[d + 5] = pre[o + 5]! ^ R[z + 5]!;
      pre[d + 6] = pre[o + 6]! ^ R[z + 6]!;
      pre[d + 7] = pre[o + 7]! ^ R[z + 7]!;
      pre[d + 8] = pre[o + 8]! ^ R[z + 8]!;
      pre[d + 9] = pre[o + 9]! ^ R[z + 9]!;
      pre[d + 10] = pre[o + 10]! ^ R[z + 10]!;
      pre[d + 11] = pre[o + 11]! ^ R[z + 11]!;
      pre[d + 12] = pre[o + 12]! ^ R[z + 12]!;
      pre[d + 13] = pre[o + 13]! ^ R[z + 13]!;
      pre[d + 14] = pre[o + 14]! ^ R[z + 14]!;
      pre[d + 15] = pre[o + 15]! ^ R[z + 15]!;
      o = d;
    }
    this.preValid = n;
    // subarray() 는 레코드마다 객체를 만든다(1M 에 수백 ms) — 손으로 옮긴다
    const v = this.vec;
    for (let t = 0, e = n * 16; t < 16; t++) v[t] = pre[e + t]!;
  }

  /** 이 국면의 정규 해시(`hash()` 뒤). */
  canon(): void {
    const v = this.vec;
    let bh = v[0]!;
    let bl = v[1]!;
    for (let t = 1; t < 8; t++) {
      const h = v[2 * t]!;
      const l = v[2 * t + 1]!;
      if (h < bh || (h === bh && l < bl)) {
        bh = h;
        bl = l;
      }
    }
    this.hi = bh;
    this.lo = bl;
  }

  /** 마지막에 둔 쪽 돌의 범위 [from, to) — 돌이 없으면 빈 범위. */
  get lastFrom(): number {
    return this.n % 2 === 1 ? 0 : this.nb;
  }
  get lastTo(): number {
    return this.n === 0 ? 0 : this.n % 2 === 1 ? this.nb : this.n;
  }

  /** k 번째 돌을 뺀 국면(부모 후보)의 정규 해시(`hash()` 뒤). */
  without(k: number): void {
    const v = this.vec;
    const R = this.rows;
    const z = ((k < this.nb ? 0 : CELLS) + this.cells[k]!) * 16;
    let bh = v[0]! ^ R[z]!;
    let bl = v[1]! ^ R[z + 1]!;
    for (let t = 2; t < 16; t += 2) {
      const h = v[t]! ^ R[z + t]!;
      const l = v[t + 1]! ^ R[z + t + 1]!;
      if (h < bh || (h === bh && l < bl)) {
        bh = h;
        bl = l;
      }
    }
    this.hi = bh;
    this.lo = bl;
  }

  /** 지금 읽은 키의 돌을 수로 — 흑 · 백 따로(키 좌표계 그대로). */
  stones(): { black: Move[]; white: Move[] } {
    const black: Move[] = [];
    const white: Move[] = [];
    for (let i = 0; i < this.n; i++) {
      const c = this.cells[i]!;
      (i < this.nb ? black : white).push(move(c >> 5, c & 31));
    }
    return { black, white };
  }
}

// ── 정규 키 (엔진 toSmallestDBKey) ───────────────────────────────────

/**
 * 돌로 엔진과 같은 정규 키 바이트를 만든다 — 8 변환마다 흑 · 백을 각각 정렬해 이은 바이트가 가장 작은 것.
 * 정사각 판만.
 */
export function canonicalKey(
  rule: number,
  w: number,
  black: readonly Move[],
  white: readonly Move[],
): Uint8Array {
  const s = w - 1;
  const n = black.length + white.length;
  let best: number[] | null = null;
  for (let t = 0; t < 8; t++) {
    const tb = black.map((m) => cellOf(transform(t, m.x, m.y, s))).sort((a, c) => a - c);
    const tw = white.map((m) => cellOf(transform(t, m.x, m.y, s))).sort((a, c) => a - c);
    const all = tb.concat(tw);
    if (best === null || lessSeq(all, best)) best = all;
  }
  const key = new Uint8Array(3 + 2 * n);
  key[0] = rule;
  key[1] = w;
  key[2] = w;
  best!.forEach((c, i) => {
    key[3 + 2 * i] = c >> 5;
    key[4 + 2 * i] = c & 31;
  });
  return key;
}

const cellOf = ([x, y]: [number, number]): number => (x << 5) | y;

function lessSeq(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
}

/** 수순(흑부터 번갈아)을 정규 키로. */
export function keyOfMoves(rule: number, w: number, moves: readonly Move[]): Uint8Array {
  return canonicalKey(
    rule,
    w,
    moves.filter((_, i) => i % 2 === 0),
    moves.filter((_, i) => i % 2 === 1),
  );
}

// ── 키 ↔ 글 ─────────────────────────────────────────────────────────

export const keyToHex = (b: Uint8Array, off = 0, len = b.length - off): string => {
  let s = "";
  for (let i = 0; i < len; i++) s += b[off + i]!.toString(16).padStart(2, "0");
  return s;
};

export function hexToKey(hex: string): Uint8Array {
  if (hex.length % 2 || /[^0-9a-f]/i.test(hex)) throw new Error(`키 글이 아님: ${hex}`);
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return b;
}

export interface DecodedKey {
  rule: number;
  w: number;
  h: number;
  black: Move[];
  white: Move[];
  /** 패스 칸이 있었다(둘 차례가 돌 수와 반대). */
  pass: boolean;
}

/** 키 바이트를 돌로 — 패스 칸은 그 구역의 끝(엔진 로더와 같다). 이상한 키면 null. */
export function decodeKey(b: Uint8Array): DecodedKey | null {
  if (b.length < 3 || (b.length - 3) & 1) return null;
  const w = b[1]!;
  const h = b[2]!;
  const slots = (b.length - 3) >> 1;
  const nb = (slots + 1) >> 1;
  const black: Move[] = [];
  const white: Move[] = [];
  let pass = false;
  for (let c = 0; c < 2; c++) {
    const begin = c === 0 ? 0 : nb;
    const cnt = c === 0 ? nb : slots - nb;
    for (let i = 0; i < cnt; i++) {
      const x = b[3 + 2 * (begin + i)]!;
      const y = b[4 + 2 * (begin + i)]!;
      if (x === 0xff && y === 0xff) {
        pass = true;
        break;
      }
      if (x >= w || y >= h) return null;
      (c === 0 ? black : white).push(move(x, y));
    }
  }
  return { rule: b[0]!, w, h, black, white, pass };
}
