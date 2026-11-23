import { COUNT as OPENINGS } from "../opening/opening26";
import type { Move } from "../model/move";
import {
  isMetaKey,
  readYxdb,
  ruleBoardName,
  valueLabel,
  YxdbCancelled,
  YxdbWriter,
  type BlobLike,
} from "./yxdbfile";
import { scanYxdb } from "./yxdbindex";
import { MAX_BOARD, transform } from "./yxdbkey";
import type { JobProgress } from "./yxdbmerge";

/**
 * yixindb 분리(라이브러리 계획 §7 · L3) — 레코드마다 «통»(bucket)을 정해 고른 통들을 새 파일로 흘려 쓴다.
 *
 * | 기준 | 통 | 필요한 것 |
 * |---|---|---|
 * | 주형별 | `0..25`, `26` 미분류 | 색인(`scanYxdb` 2차 통과의 `onClassified`) |
 * | 이 국면 아래 | `in` · `out` | 판 국면 — 같은 규칙 · 판이고 흑 ⊇ · 백 ⊇ (8 대칭 중 하나) |
 * | 풀린 국면만 | `solved` · `open` | 라벨 W/L/D |
 * | 규칙 · 판 | `renju-15` … | 키 머리 |
 *
 * 머리에 레코드 수를 먼저 적으므로 세기(`countSplit`, 미리 보기)와 쓰기(`runSplit`)가 따로다. 메타데이터 레코드는
 * 결과마다 맨 앞에 한 벌씩(수에는 넣지 않고 머리에는 넣는다). 레코드는 원본 순서 그대로라 결과도 키 순서다.
 */

export type SplitCriterion = "opening" | "under" | "solved" | "rule";

/** «이 국면 아래»의 기준 국면 — 판 크기 · 규칙 · 흑 · 백(키 좌표계, 정사각 판). */
export interface SplitBase {
  rule: number;
  size: number;
  black: readonly Move[];
  white: readonly Move[];
}

export interface SplitCounts {
  /** 메타데이터를 뺀 레코드 수 — 결과 합계의 대조. */
  total: number;
  /** 메타데이터 레코드가 있었다(결과마다 한 벌씩 붙는다). */
  meta: boolean;
  /** 주형별(27칸, 26 = 미분류). 색인이 없거나 돌 수 순서가 아니면 null. */
  openings: number[] | null;
  /** 주형을 못 센 까닭. */
  openingsSkipped?: "memory" | "alloc" | "unordered";
  /** 기준 국면 아래(그 국면 포함). 기준이 없으면 null. */
  under: number | null;
  /** W/L/D 로 풀린 국면. */
  solved: number;
  /** 규칙 · 판별. */
  rules: Record<string, number>;
}

export interface SplitOutput {
  /** 이 결과에 담을 통들. 결과끼리 겹치지 않는다. */
  buckets: readonly (number | string)[];
  /** 미리 보기에서 센 레코드 수(메타데이터 빼고) — 쓰기가 대조한다. */
  count: number;
}

export interface SplitPlan {
  criterion: SplitCriterion;
  outputs: readonly SplitOutput[];
  /** 어느 결과에도 들지 않은 레코드를 따로 한 파일로(옮기기 — 원본을 이것으로 바꾼다). 그 수. */
  rest?: { count: number };
  base?: SplitBase;
}

export interface SplitRunOptions {
  isCancelled?: () => boolean;
  onProgress?: (p: JobProgress) => void;
  maxIndexBytes?: number;
}

const LABEL_SOLVED = new Set([0x77, 0x6c, 0x64, 0x57, 0x4c, 0x44]);

/**
 * 기준 국면 아래인가 — 8 대칭 중 하나로 옮긴 기준의 흑 · 백이 모두 이 키의 같은 색 돌에 있다. 판(1024칸)은 다시 쓴다.
 */
export class UnderTest {
  private readonly board = new Uint8Array(MAX_BOARD * MAX_BOARD);
  /** 대칭마다 기준 돌 칸 `(x << 5) | y` — 흑 다음 백, 색 표시는 `nb` 로. */
  private readonly sets: Uint16Array[] = [];
  private readonly nb: number;

  constructor(private readonly base: SplitBase) {
    const s = base.size - 1;
    this.nb = base.black.length;
    for (let t = 0; t < 8; t++) {
      const cells = new Uint16Array(base.black.length + base.white.length);
      [...base.black, ...base.white].forEach((m, i) => {
        const [x, y] = transform(t, m.x, m.y, s);
        cells[i] = (x << 5) | y;
      });
      this.sets.push(cells);
    }
  }

  test(b: Uint8Array, ko: number, kl: number): boolean {
    if (kl < 3 || (kl - 3) & 1) return false;
    const w = b[ko + 1]!;
    if (b[ko]! !== this.base.rule || w !== this.base.size || b[ko + 2]! !== w) return false;
    const n = (kl - 3) >> 1;
    const nb = (n + 1) >> 1;
    const total = this.sets[0]!.length;
    if (n < total || nb < this.nb || n - nb < total - this.nb) return false;
    const board = this.board;
    for (let i = 0, p = ko + 3; i < n; i++, p += 2) {
      const x = b[p]!;
      const y = b[p + 1]!;
      if (x >= w || y >= w) {
        this.clear(b, ko, i);
        return false; // 패스 칸
      }
      board[(x << 5) | y] = i < nb ? 1 : 2;
    }
    let ok = false;
    for (let t = 0; t < 8 && !ok; t++) {
      const cells = this.sets[t]!;
      ok = true;
      for (let i = 0; i < cells.length; i++)
        if (board[cells[i]!] !== (i < this.nb ? 1 : 2)) {
          ok = false;
          break;
        }
    }
    this.clear(b, ko, n);
    return ok;
  }

  private clear(b: Uint8Array, ko: number, upto: number): void {
    for (let i = 0, p = ko + 3; i < upto; i++, p += 2) this.board[(b[p]! << 5) | b[p + 1]!] = 0;
  }
}

const ruleKey = (b: Uint8Array, ko: number): string =>
  ruleBoardName(b[ko]!, b[ko + 1]!, b[ko + 2]!);

/**
 * 미리 보기 — 모든 기준의 통 수를 한 번에 센다. 주형은 색인이 있어야 해서 `scanYxdb` 를 돌린다(색인을 건너뛰면
 * 나머지만). `withOpenings` 가 false 면 색인 없이 한 번만 흘려 읽는다.
 */
export async function countSplit(
  blob: BlobLike,
  base: SplitBase | null,
  opts: SplitRunOptions & { withOpenings?: boolean } = {},
): Promise<SplitCounts> {
  const counts: SplitCounts = {
    total: 0,
    meta: false,
    openings: null,
    under: base ? 0 : null,
    solved: 0,
    rules: {},
  };
  const under = base ? new UnderTest(base) : null;
  const openings = new Array<number>(OPENINGS + 1).fill(0);
  const tally = (b: Uint8Array, ko: number, kl: number, vo: number, vl: number) => {
    if (isMetaKey(b, ko, kl)) {
      counts.meta = true;
      return false;
    }
    counts.total++;
    if (LABEL_SOLVED.has(valueLabel(b, vo, vl))) counts.solved++;
    if (under?.test(b, ko, kl)) counts.under!++;
    const rk = ruleKey(b, ko);
    counts.rules[rk] = (counts.rules[rk] ?? 0) + 1;
    return true;
  };
  if (opts.withOpenings ?? true) {
    let classified = false;
    const r = await scanYxdb(blob, {
      index: true,
      ...(opts.maxIndexBytes !== undefined ? { maxIndexBytes: opts.maxIndexBytes } : {}),
      onClassified: (b, ko, kl, vo, vl, o) => {
        classified = true;
        if (tally(b, ko, kl, vo, vl)) openings[o]!++;
      },
      onProgress: (p) => opts.onProgress?.({ phase: "count", fraction: p.fraction }),
      ...(opts.isCancelled ? { isCancelled: opts.isCancelled } : {}),
    });
    const skipped = r.indexSkipped ?? r.openingsSkipped;
    if (classified && !skipped) {
      counts.openings = openings;
      return counts;
    }
    if (skipped) counts.openingsSkipped = skipped;
    if (classified) {
      // 색인은 됐지만 돌 수 순서가 아니다 — 주형만 버리고 센 것은 그대로
      return counts;
    }
  }
  // 색인 없이 — 한 번 흘려 읽는다
  counts.total = 0;
  counts.meta = false;
  counts.solved = 0;
  counts.rules = {};
  if (base) counts.under = 0;
  await readYxdb(blob, (b, ko, kl, vo, vl) => void tally(b, ko, kl, vo, vl), {
    onChunk: (loaded, total) =>
      opts.onProgress?.({ phase: "count", fraction: total > 0 ? loaded / total : 1 }),
    ...(opts.isCancelled ? { isCancelled: opts.isCancelled } : {}),
  });
  return counts;
}

/**
 * 나눈다 — 결과마다 `sink(i)` 로 흘려 쓴다(`rest` 는 맨 뒤 번호). 결과가 많아도(주형 27) 메모리가 모자라지 않게
 * 결과마다 256KB 버퍼 · 256KB LZ4 블록. 미리 보기의 수와 다르면(그새 파일이 바뀜) 던진다.
 */
export async function runSplit(
  blob: BlobLike,
  plan: SplitPlan,
  sinks: readonly ((chunk: Uint8Array) => void)[],
  meta: boolean,
  opts: SplitRunOptions = {},
): Promise<number[]> {
  const n = plan.outputs.length + (plan.rest ? 1 : 0);
  if (sinks.length !== n) throw new Error("split: 결과 수와 sink 수가 다름");
  const route = new Map<number | string, number>();
  plan.outputs.forEach((o, i) => o.buckets.forEach((b) => route.set(b, i)));
  const restIndex = plan.rest ? plan.outputs.length : -1;
  const expected = [...plan.outputs.map((o) => o.count), ...(plan.rest ? [plan.rest.count] : [])];
  const writers = expected.map(
    (c, i) =>
      new YxdbWriter(c + (meta ? 1 : 0), sinks[i]!, {
        blockKB: 256,
        bufferKB: 256,
      }),
  );
  const got = new Array<number>(n).fill(0);
  let sawMeta = false;
  const put = (
    bucket: number | string,
    b: Uint8Array,
    ko: number,
    kl: number,
    vo: number,
    vl: number,
  ) => {
    const i = route.get(bucket) ?? restIndex;
    if (i < 0) return;
    got[i]!++;
    writers[i]!.record(b, ko, kl, vo, vl);
  };
  const writeMeta = (b: Uint8Array, ko: number, kl: number, vo: number, vl: number): boolean => {
    if (!isMetaKey(b, ko, kl)) return false;
    if (!sawMeta && meta) for (const w of writers) w.record(b, ko, kl, vo, vl);
    sawMeta = true;
    return true;
  };
  const progress = (f: number) => opts.onProgress?.({ phase: "write", fraction: f });
  const cancelOpt = opts.isCancelled ? { isCancelled: opts.isCancelled } : {};

  if (plan.criterion === "opening") {
    const r = await scanYxdb(blob, {
      index: true,
      ...(opts.maxIndexBytes !== undefined ? { maxIndexBytes: opts.maxIndexBytes } : {}),
      onClassified: (b, ko, kl, vo, vl, o) => {
        if (writeMeta(b, ko, kl, vo, vl) || o < 0) return;
        put(o, b, ko, kl, vo, vl);
      },
      onProgress: (p) => progress(p.fraction),
      ...cancelOpt,
    });
    if (r.indexSkipped || r.openingsSkipped)
      throw new Error(`split: 주형을 셀 수 없음(${r.indexSkipped ?? r.openingsSkipped})`);
  } else {
    const under = plan.criterion === "under" && plan.base ? new UnderTest(plan.base) : null;
    if (plan.criterion === "under" && !under) throw new Error("split: 기준 국면이 없음");
    await readYxdb(
      blob,
      (b, ko, kl, vo, vl) => {
        if (writeMeta(b, ko, kl, vo, vl)) return;
        const bucket =
          plan.criterion === "under"
            ? under!.test(b, ko, kl)
              ? "in"
              : "out"
            : plan.criterion === "solved"
              ? LABEL_SOLVED.has(valueLabel(b, vo, vl))
                ? "solved"
                : "open"
              : ruleKey(b, ko);
        put(bucket, b, ko, kl, vo, vl);
      },
      { onChunk: (l, t) => progress(t > 0 ? l / t : 1), ...cancelOpt },
    );
  }
  if (opts.isCancelled?.()) throw new YxdbCancelled();
  if (meta && !sawMeta) throw new Error("split: 메타데이터 레코드가 사라짐");
  for (const w of writers) w.finish();
  return got;
}

/** 기준별 통 — 화면이 결과를 짤 때. */
export const SOLVED_BUCKETS = { solved: "solved", open: "open" } as const;
export const UNDER_BUCKETS = { in: "in", out: "out" } as const;
