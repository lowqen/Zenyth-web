import { isLz4Frame, Lz4FrameDecoder } from "./lz4frame";
import {
  compareYxdbKeys,
  isMetaKey,
  readYxdb,
  YxdbCancelled,
  YxdbRecordParser,
  YxdbWriter,
  type BlobLike,
} from "./yxdbfile";

/**
 * yixindb 병합(라이브러리 계획 §7 · L3) — 엔진 파일은 키 순서(§8)라 입력마다 블록 하나만 들고 k-way 로 흘려 합친다.
 * 순서가 아닌 입력(다른 프로그램이 쓴 것)은 정렬된 묶음(run)으로 잘라 «쏟는 곳»(`Spill`)에 두고 그 묶음들을 합친다.
 *
 * 머리에 레코드 수를 먼저 적어야 하므로 두 번 흐른다 — 미리 보기(`out` 없이, 합계 · 겹침 · 값이 다른 것을 센다)와
 * 쓰기(`out.count` = 미리 보기의 `records`). 그 사이에 입력이 바뀌었으면 쓰기가 레코드 수에서 멈춘다.
 */

/** 진행 — 단계 이름 · 0..1. */
export interface JobProgress {
  phase: string;
  fraction: number;
  records?: number;
}

export class YxdbUnsorted extends Error {
  constructor(readonly rank: number) {
    super(`yixindb: 입력 ${rank} 이 키 순서가 아님`);
    this.name = "YxdbUnsorted";
  }
}

// ── 당겨 읽기 ───────────────────────────────────────────────────────

/**
 * 레코드를 하나씩 당겨 읽는다(`readYxdb` 는 미는 쪽). 스트림 조각 하나를 풀어 그 안의 레코드만 작은 판(arena)에
 * 옮겨 둔다 — 지금 레코드(`buf` · `keyOff` …)는 다음 `next()` 까지만 유효하다.
 */
export class YxdbCursor {
  buf = new Uint8Array(1 << 16);
  keyOff = 0;
  keyLen = 0;
  valOff = 0;
  valLen = 0;
  /** 머리의 레코드 수(읽기 전엔 -1). */
  count = -1;
  /** 읽은 (압축) 바이트. */
  loaded = 0;
  /** 앞 레코드보다 작은 키가 나왔다(`checkOrder`). */
  unsorted = false;
  private offs = new Int32Array(4 * 1024);
  private n = 0;
  private i = 0;
  private len = 0;
  private ended = false;
  private decided = false;
  private head = new Uint8Array(0);
  private decoder: Lz4FrameDecoder | null = null;
  private readonly parser: YxdbRecordParser;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly prev = new Uint8Array(0x10000);
  private prevLen = -1;
  private hasCur = false;

  constructor(
    blob: BlobLike,
    private readonly opts: { isCancelled?: () => boolean; checkOrder?: boolean } = {},
  ) {
    this.reader = blob.stream().getReader();
    this.parser = new YxdbRecordParser(
      (b, ko, kl, vo, vl) => this.keep(b, ko, kl, vo, vl),
      (c) => (this.count = c),
    );
  }

  private keep(b: Uint8Array, ko: number, kl: number, vo: number, vl: number): void {
    const need = this.len + kl + vl;
    if (need > this.buf.length) {
      const nb = new Uint8Array(Math.max(need, this.buf.length * 2));
      nb.set(this.buf.subarray(0, this.len));
      this.buf = nb;
    }
    if (4 * (this.n + 1) > this.offs.length) {
      const no = new Int32Array(this.offs.length * 2);
      no.set(this.offs);
      this.offs = no;
    }
    const o = 4 * this.n++;
    this.offs[o] = this.len;
    this.offs[o + 1] = kl;
    this.buf.set(b.subarray(ko, ko + kl), this.len);
    this.len += kl;
    this.offs[o + 2] = this.len;
    this.offs[o + 3] = vl;
    this.buf.set(b.subarray(vo, vo + vl), this.len);
    this.len += vl;
  }

  private feed = (b: Uint8Array, off: number, len: number) => this.parser.push(b, off, len);

  /** 스트림 조각 하나를 읽는다 — 레코드가 하나도 안 나올 수도 있다. */
  private async fill(): Promise<void> {
    if (this.opts.isCancelled?.()) throw new YxdbCancelled();
    const { done, value } = await this.reader.read();
    if (done) {
      if (!this.decided && this.head.length > 0) this.feed(this.head, 0, this.head.length);
      this.decoder?.end();
      this.parser.end();
      this.ended = true;
      this.reader.releaseLock();
      return;
    }
    this.loaded += value.byteLength;
    let chunk = value;
    if (!this.decided) {
      const h = new Uint8Array(this.head.length + chunk.length);
      h.set(this.head);
      h.set(chunk, this.head.length);
      if (h.length < 4) {
        this.head = h;
        return;
      }
      this.decided = true;
      chunk = h;
      if (isLz4Frame(h)) this.decoder = new Lz4FrameDecoder(this.feed);
    }
    if (this.decoder) this.decoder.push(chunk);
    else this.feed(chunk, 0, chunk.length);
  }

  /** 다음 레코드로. 끝이면 false. */
  async next(): Promise<boolean> {
    if (this.opts.checkOrder && this.hasCur) {
      this.prev.set(this.buf.subarray(this.keyOff, this.keyOff + this.keyLen));
      this.prevLen = this.keyLen;
    }
    this.hasCur = false;
    this.i++;
    while (this.i >= this.n) {
      if (this.ended) return false;
      this.n = 0;
      this.i = 0;
      this.len = 0;
      await this.fill();
    }
    const o = 4 * this.i;
    this.keyOff = this.offs[o]!;
    this.keyLen = this.offs[o + 1]!;
    this.valOff = this.offs[o + 2]!;
    this.valLen = this.offs[o + 3]!;
    this.hasCur = true;
    if (
      this.opts.checkOrder &&
      this.prevLen > 0 &&
      compareYxdbKeys(this.prev, 0, this.prevLen, this.buf, this.keyOff, this.keyLen) > 0
    )
      this.unsorted = true;
    return true;
  }

  /** 다 읽기 전에 그만둔다. */
  async close(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    await this.reader.cancel().catch(() => {});
    this.reader.releaseLock();
  }
}

// ── 쏟는 곳 ─────────────────────────────────────────────────────────

/** 임시 바이트를 받아 두는 곳 — 끝나면 `Blob`. 브라우저는 큰 Blob 을 디스크 쪽에 둔다(힙에 통째 들지 않는다). */
export interface Spill {
  write(chunk: Uint8Array): void;
  finish(): Blob;
  readonly bytes: number;
}

/** 조각을 모아 8MB 마다 Blob 으로 접는다 — 들고 있는 힙은 접기 전 조각들뿐. */
export function blobSpill(foldBytes = 8 << 20): Spill {
  let blob = new Blob([]);
  let parts: Uint8Array[] = [];
  let pending = 0;
  let total = 0;
  const fold = () => {
    if (parts.length === 0) return;
    blob = new Blob([blob, ...(parts as BlobPart[])]);
    parts = [];
    pending = 0;
  };
  return {
    write(chunk) {
      parts.push(chunk);
      pending += chunk.length;
      total += chunk.length;
      if (pending >= foldBytes) fold();
    },
    finish() {
      fold();
      return blob;
    },
    get bytes() {
      return total;
    },
  };
}

// ── 순서가 아닌 입력 → 정렬된 묶음 ────────────────────────────────

/**
 * 파일을 `runBytes` 씩 끊어 묶음마다 키 순서로 정렬해 (압축 없이) 쏟는다. 들고 있는 힙은 묶음 하나.
 * 병합은 이 묶음들을 원래 입력의 순위(rank)로 합친다.
 */
export async function sortedRuns(
  blob: BlobLike,
  newSpill: () => Spill,
  opts: {
    runBytes?: number;
    isCancelled?: () => boolean;
    onProgress?: (fraction: number) => void;
  } = {},
): Promise<Blob[]> {
  const runBytes = opts.runBytes ?? 32 << 20;
  const runs: Blob[] = [];
  let arena = new Uint8Array(Math.min(runBytes + 0x20000, 1 << 20));
  let len = 0;
  let offs = new Int32Array(4 * 4096);
  let n = 0;
  const flush = () => {
    if (n === 0) return;
    const order = Array.from({ length: n }, (_, i) => i);
    const a = arena;
    const o = offs;
    order.sort((x, y) => compareYxdbKeys(a, o[4 * x]!, o[4 * x + 1]!, a, o[4 * y]!, o[4 * y + 1]!));
    const spill = newSpill();
    const w = new YxdbWriter(n, (c) => spill.write(c), { compress: false });
    for (const i of order) w.recordKV(a, o[4 * i]!, o[4 * i + 1]!, a, o[4 * i + 2]!, o[4 * i + 3]!);
    w.finish();
    runs.push(spill.finish());
    len = 0;
    n = 0;
  };
  await readYxdb(
    blob,
    (b, ko, kl, vo, vl) => {
      if (len + kl + vl > runBytes && n > 0) flush();
      if (len + kl + vl > arena.length) {
        const na = new Uint8Array(
          Math.max(len + kl + vl, Math.min(arena.length * 2, runBytes + 0x20000)),
        );
        na.set(arena.subarray(0, len));
        arena = na;
      }
      if (4 * (n + 1) > offs.length) {
        const no = new Int32Array(offs.length * 2);
        no.set(offs);
        offs = no;
      }
      const q = 4 * n++;
      offs[q] = len;
      offs[q + 1] = kl;
      arena.set(b.subarray(ko, ko + kl), len);
      len += kl;
      offs[q + 2] = len;
      offs[q + 3] = vl;
      arena.set(b.subarray(vo, vo + vl), len);
      len += vl;
    },
    {
      ...(opts.isCancelled ? { isCancelled: opts.isCancelled } : {}),
      onChunk: (loaded, total) => opts.onProgress?.(total > 0 ? loaded / total : 1),
    },
  );
  flush();
  return runs;
}

// ── 병합 ───────────────────────────────────────────────────────────

/** 같은 국면이 둘 이상에 있을 때 — 더 깊은 기록(권장) · 기준(맨 위) 우선. */
export type MergePolicy = "deeper" | "base";

export interface MergeOptions {
  policy: MergePolicy;
  /** 주석을 이어 붙인다(같은 글은 하나로). 끄면 고른 기록의 주석만. */
  joinComments: boolean;
  isCancelled?: () => boolean;
  onProgress?: (p: JobProgress) => void;
}

/** 입력 하나 — 순서가 아닌 파일은 묶음 여럿이 같은 `rank`(원래 순서, 0 = 기준)를 갖는다. */
export interface MergeSource {
  blob: BlobLike;
  rank: number;
}

export interface MergeSummary {
  /** 쓸 레코드 수(메타데이터 포함) — 머리에 적는 수. */
  records: number;
  /** 결과의 국면 수(메타데이터 빼고). */
  positions: number;
  /** 입력 순위마다 국면 수(같은 입력 안의 중복은 하나로). */
  inputPositions: number[];
  /** 둘 이상의 입력에 있던 국면. */
  overlaps: number;
  /** 겹친 것 중 기록(라벨 · 값 · 깊이)이 서로 다른 것. */
  differing: number;
}

const LABEL_W = 0x77;
const LABEL_L = 0x6c;
const LABEL_D = 0x64;
const isSolved = (l: number) =>
  l === LABEL_W || l === LABEL_L || l === LABEL_D || l === 0x57 || l === 0x4c || l === 0x44;

/**
 * 값의 깊이 — `depthbound` 는 i16 `depth << 2 | bound`(Rapfi `DBRecord`). 기록이 없으면 -∞ 라 늘 진다.
 * 짜임이 달라도 depth 가 윗비트에 있는 한 크기 비교는 같다.
 */
function depthOf(b: Uint8Array, o: number, l: number): number {
  if (l < 5) return l === 0 ? -Infinity : -1e9;
  const v = ((b[o + 3]! | (b[o + 4]! << 8)) << 16) >> 16;
  return v >> 2;
}

/**
 * 키 순서 입력들을 합친다. `out` 이 없으면 세기만 한다(미리 보기). 있으면 `out.count`(미리 보기의 `records`)로
 * 머리를 적고 흘려 쓴다 — 수가 다르면(그새 입력이 바뀜) `YxdbWriter.finish` 가 던진다.
 * 순서가 아닌 입력을 만나면 `YxdbUnsorted(rank)` — 부르는 쪽이 그 입력을 `sortedRuns` 로 바꿔 다시 부른다.
 */
export async function mergeYxdb(
  sources: readonly MergeSource[],
  opts: MergeOptions,
  out?: { count: number; sink: (chunk: Uint8Array) => void; blockKB?: 64 | 256 | 1024 | 4096 },
): Promise<MergeSummary> {
  const cancelled = () => opts.isCancelled?.() ?? false;
  const total = sources.reduce((s, x) => s + x.blob.size, 0) || 1;
  const ranks = Math.max(0, ...sources.map((s) => s.rank)) + 1;
  const cursors: YxdbCursor[] = [];
  const alive: boolean[] = [];
  try {
    for (const s of sources) {
      const c = new YxdbCursor(s.blob, { isCancelled: cancelled, checkOrder: true });
      cursors.push(c);
      alive.push(await c.next());
      if (c.unsorted) throw new YxdbUnsorted(s.rank);
    }
    const writer = out
      ? new YxdbWriter(out.count, out.sink, { blockKB: out.blockKB ?? 4096 })
      : null;
    const summary: MergeSummary = {
      records: 0,
      positions: 0,
      inputPositions: new Array<number>(ranks).fill(0),
      overlaps: 0,
      differing: 0,
    };
    const key = new Uint8Array(0x10000);
    // 이 국면의 값들 — 순위 순으로(같은 순위 안에서는 먼저 나온 것)
    let vals = new Uint8Array(1 << 16);
    const vOff: number[] = [];
    const vLen: number[] = [];
    const vRank: number[] = [];
    const seenRank = new Uint8Array(ranks);
    const outVal = new Uint8Array(0x10000);
    let lastPost = 0;
    const post = () => {
      const now = performance.now();
      if (now - lastPost < 100) return;
      lastPost = now;
      const loaded = cursors.reduce((s, c) => s + c.loaded, 0);
      opts.onProgress?.({
        phase: out ? "write" : "count",
        fraction: Math.min(1, loaded / total),
        records: summary.positions,
      });
    };

    for (let step = 0; ; step++) {
      // 가장 작은 머리 — 입력이 몇 개 안 되어 그냥 훑는다
      let m = -1;
      for (let j = 0; j < cursors.length; j++) {
        if (!alive[j]) continue;
        if (m < 0) {
          m = j;
          continue;
        }
        const a = cursors[j]!;
        const b = cursors[m]!;
        const c = compareYxdbKeys(a.buf, a.keyOff, a.keyLen, b.buf, b.keyOff, b.keyLen);
        if (c < 0 || (c === 0 && sources[j]!.rank < sources[m]!.rank)) m = j;
      }
      if (m < 0) break;
      const cm = cursors[m]!;
      const kl = cm.keyLen;
      key.set(cm.buf.subarray(cm.keyOff, cm.keyOff + kl));
      vOff.length = vLen.length = vRank.length = 0;
      seenRank.fill(0);
      let vlen = 0;
      // 이 키를 가진 머리를 모두 모은다(같은 입력 안의 중복도)
      for (let j = 0; j < cursors.length; j++) {
        const c = cursors[j]!;
        while (alive[j] && compareYxdbKeys(c.buf, c.keyOff, c.keyLen, key, 0, kl) === 0) {
          if (vlen + c.valLen > vals.length) {
            const nv = new Uint8Array(Math.max(vlen + c.valLen, vals.length * 2));
            nv.set(vals.subarray(0, vlen));
            vals = nv;
          }
          vals.set(c.buf.subarray(c.valOff, c.valOff + c.valLen), vlen);
          // 순위 순으로 끼운다
          const r = sources[j]!.rank;
          let at = vRank.length;
          while (at > 0 && vRank[at - 1]! > r) at--;
          vOff.splice(at, 0, vlen);
          vLen.splice(at, 0, c.valLen);
          vRank.splice(at, 0, r);
          vlen += c.valLen;
          seenRank[r] = 1;
          alive[j] = await c.next();
          if (c.unsorted) throw new YxdbUnsorted(r);
        }
      }
      const meta = isMetaKey(key, 0, kl);
      let distinct = 0;
      for (let r = 0; r < ranks; r++)
        if (seenRank[r]) {
          distinct++;
          if (!meta) summary.inputPositions[r]!++;
        }

      // 고르기
      let pick = -1;
      for (let i = 0; i < vOff.length; i++) {
        if (vLen[i] === 0) continue;
        if (pick < 0) {
          pick = i;
          if (opts.policy === "base") break;
          continue;
        }
        const d = depthOf(vals, vOff[i]!, vLen[i]!) - depthOf(vals, vOff[pick]!, vLen[pick]!);
        if (d > 0 || (d === 0 && isSolved(vals[vOff[i]!]!) && !isSolved(vals[vOff[pick]!]!)))
          pick = i;
      }
      if (!meta && distinct > 1) {
        summary.overlaps++;
        let differ = false;
        let first = -1;
        for (let i = 0; i < vOff.length && !differ; i++) {
          if (vLen[i] === 0) continue;
          if (first < 0) first = i;
          else
            for (let k = 0; k < 5; k++)
              if ((vals[vOff[i]! + k] ?? -1) !== (vals[vOff[first]! + k] ?? -1)) {
                differ = true;
                break;
              }
        }
        if (differ) summary.differing++;
      }
      summary.records++;
      if (!meta) summary.positions++;

      if (writer) {
        let ob = vals;
        let oo = 0;
        let ol = 0;
        if (pick >= 0) {
          oo = vOff[pick]!;
          ol = vLen[pick]!;
          if (opts.joinComments && vOff.length > 1 && ol >= 5) {
            // 고른 기록에 주석이 없어도 다른 쪽 주석은 살린다
            const joined = joinTexts(vals, vOff, vLen, pick, outVal);
            if (joined > 0) {
              ob = outVal;
              oo = 0;
              ol = joined;
            }
          }
        }
        writer.recordKV(key, 0, kl, ob, oo, ol);
      }
      if ((step & 1023) === 0) {
        if (cancelled()) throw new YxdbCancelled();
        post();
      }
    }
    writer?.finish();
    opts.onProgress?.({ phase: out ? "write" : "count", fraction: 1, records: summary.positions });
    return summary;
  } finally {
    for (const c of cursors) await c.close();
  }
}

/**
 * 고른 기록의 머리(5바이트) + 주석들을 순위 순으로 줄바꿈으로 잇는다(같은 글은 하나로). 넘치면(64KB) 0 —
 * 고른 기록 그대로 쓴다.
 */
function joinTexts(
  vals: Uint8Array,
  vOff: readonly number[],
  vLen: readonly number[],
  pick: number,
  out: Uint8Array,
): number {
  const texts: [number, number][] = [];
  for (let i = 0; i < vOff.length; i++) {
    const l = vLen[i]! - 5;
    if (l <= 0) continue;
    const o = vOff[i]! + 5;
    const dup = texts.some(([po, pl]) => {
      if (pl !== l) return false;
      for (let k = 0; k < l; k++) if (vals[po + k] !== vals[o + k]) return false;
      return true;
    });
    if (!dup) texts.push([o, l]);
  }
  if (texts.length === 0) return 0;
  // 주석이 하나뿐이고 그게 고른 기록의 것이면 그대로
  if (texts.length === 1 && texts[0]![0] === vOff[pick]! + 5) return 0;
  let n = 5;
  for (const [, l] of texts) n += l + 1;
  n -= 1;
  if (n > out.length) return 0;
  out.set(vals.subarray(vOff[pick]!, vOff[pick]! + 5), 0);
  let p = 5;
  texts.forEach(([o, l], i) => {
    if (i > 0) out[p++] = 0x0a;
    out.set(vals.subarray(o, o + l), p);
    p += l;
  });
  return p;
}

/** 파일의 레코드 수를 다시 센다(원자적 쓰기의 대조). */
export async function countYxdb(blob: BlobLike, isCancelled?: () => boolean): Promise<number> {
  let n = 0;
  await readYxdb(blob, () => void n++, isCancelled ? { isCancelled } : {});
  return n;
}
