import { classify, COUNT as OPENINGS, NONSTD } from "../opening/opening26";
import { move } from "../model/move";
import {
  compareYxdbKeys,
  isMetaKey,
  readYxdb,
  ruleBoardName,
  RULE_RENJU,
  RULE_STANDARD,
  valueLabel,
  valueTextLength,
  YxdbCancelled,
  type BlobLike,
} from "./yxdbfile";
import { KeyHasher, keyToHex } from "./yxdbkey";
import { INDEX_VERSION } from "./yxdbstats";

export { INDEX_VERSION, statsCurrent } from "./yxdbstats";

/**
 * yixindb 통계 · 색인 — 라이브러리 워커(`library.worker.ts`)가 돌린다(라이브러리 계획 §4 · §5).
 *
 * **풀린 바이트를 한 번도 통째로 들지 않는다.** 통계만이면 한 번 흘려 읽고 O(1) 메모리. 색인은 레코드당 고정 폭
 * 배열만 든다(키 바이트 없음):
 *
 * | 배열 | 폭 | 쓰임 |
 * |---|---|---|
 * | 슬롯 `[hi, lo, info]` | 4 + 4 + 4 | 대칭 해시(정렬) · 주형 · 돌 수 — 2차 통과 뒤 hi 는 부분 트리 크기, lo 는 순서 목록 |
 * | `parent` | 4 | 첫 부모의 슬롯(뿌리 · 부분 트리). 뿌리는 `~레코드 번호` — 뿌리 키를 다시 읽을 때 맞춘다 |
 * | 비트맵 | 1 ~ 2 | 없는 부모 후보를 메모리까지 가지 않고 거른다(2차 통과 뒤 놓는다) |
 *
 * 1. 1차 통과: 통계 + 해시. 해시를 윗비트 통에 제자리로 나눠(American flag sort) 통 안을 삽입 정렬.
 * 2. 2차 통과: 레코드마다 부모 후보(마지막 둔 쪽 돌 하나씩 뺀 국면)를 찾는다. 엔진 파일은 돌 수 순서라 부모가
 *    늘 먼저 정해져 있다 — **모든 부모**의 주형을 보고 정한다(색인 판 3, L5-6):
 *    - 주형(0..25)인 부모만 표를 던진다. 표가 모두 같으면 그 주형, 다르면 **엇갈림**(`MIXED` = 27).
 *    - 비표준 · 분류 밖 부모(26)는 표를 던지지 않는다 — 대칭 동치로 생긴 비표준 부모 하나가 표준 줄 자손 전체를
 *      미분류로 만들던 일(실기: 807만 → 3).
 *    - 엇갈린 부모가 하나라도 있으면 엇갈림이 이어진다. 표가 없으면(부모 없음 · 비표준만) 26.
 *    추측하지 않는다(§5): 엇갈림도 밖으로는 미분류(26)로 낸다. 3돌 국면은 `opening26.classify`.
 * 3. 부분 트리 크기: 돌 수 큰 국면부터 첫 부모에 더한다. 부모 없는 국면 = 뿌리, 큰 순 상위 N.
 * 4. 시작점: 뿌리에서, 가장 무거운 자식이 그 부분 트리의 `START_SHARE`(90%) 이상인 동안 내려간 국면(L5-6 결정 —
 *    엔진이 조회하며 남긴 빈 기록 때문에 가장 큰 뿌리가 빈 판이어도, 실제 기록이 갈라지는 곳에서 연다).
 *
 * 돌 수 순서가 아닌 파일(다른 프로그램이 쓴 것)은 주형을 건너뛰고(`openingsSkipped: "unordered"`) 뿌리만 낸다.
 */

export interface DbLabels {
  W: number;
  L: number;
  D: number;
  /** 기록이 있되 W · L · D 가 아닌 라벨. */
  other: number;
}

export interface DbRoot {
  /** 키 바이트 16진(`keyToHex`) — `decodeKey(hexToKey(key))` 로 돌을 얻는다. */
  key: string;
  /** 첫 부모로 이은 부분 트리의 국면 수(자기 포함). */
  subtree: number;
  /**
   * 시작점 키(16진) — 뿌리에서 가장 무거운 자식이 90% 이상인 동안 내려간 국면. 뿌리 자신이면 없다.
   * 색인 판 3 부터.
   */
  start?: string;
}

export interface DbStats {
  /** 국면 레코드 수(메타데이터 제외). */
  records: number;
  /** 이 통계를 낸 색인의 판(`INDEX_VERSION`). 없으면 1. */
  indexVersion?: number;
  /** `renju-15` 따위 → 국면 수. 섞였는지 본다. */
  rules: Record<string, number>;
  labels: DbLabels;
  /** 글(주석)이 있는 레코드. */
  commented: number;
  /** 길이 27 = 26주형 + 미분류(렌주 · 표준 15줄 국면만 센다). 색인을 건너뛰었거나 그런 국면이 없으면 없다. */
  openings?: number[];
  /** 부모 없는 국면, 부분 트리 큰 순. 색인을 건너뛰면 없다. */
  roots?: DbRoot[];
}

export type ScanPhase = "stats" | "hash" | "link" | "roots";

export interface ScanProgress {
  phase: ScanPhase;
  /** 전체 작업 기준 0..1. */
  fraction: number;
  records: number;
}

export interface ScanOptions {
  /** 색인(주형 · 뿌리)까지. 기본 켬. */
  index?: boolean;
  /** 색인 메모리 상한(바이트). 넘으면 통계만(`indexSkipped: "memory"`). 기본 무한. */
  maxIndexBytes?: number;
  /** 뿌리 상위 몇 개. 기본 32. */
  rootsTop?: number;
  /** 2차 통과에서 모아 둘 뿌리 키의 어림 바이트 상한. 넘으면 버리고 끝에 한 번 더 읽는다. 기본 8MB(시험이 줄인다). */
  rootKeyCap?: number;
  /** LZ4 내용 체크섬 확인(기본 꺼짐). */
  verify?: boolean;
  /**
   * 2차 통과에서 **모든 레코드**마다 그 주형(0..25, 26 = 미분류) — 분리(L3)가 쓴다. 메타데이터는 -1, 특수 · 분류
   * 밖(규칙 · 판)은 26, 같은 국면이 또 나오면 처음 것의 주형. 색인을 건너뛰면 부르지 않는다.
   */
  onClassified?: (
    buf: Uint8Array,
    keyOff: number,
    keyLen: number,
    valOff: number,
    valLen: number,
    opening: number,
  ) => void;
  onProgress?: (p: ScanProgress) => void;
  isCancelled?: () => boolean;
}

export interface ScanResult {
  stats: DbStats;
  /** 머리의 레코드 수(메타데이터 포함). */
  count: number;
  compressed: boolean;
  rawBytes: number;
  /** 엔진 키 순서 그대로인가 — 병합이 스트리밍만으로 되는가(§4). */
  sorted: boolean;
  /** 같은 키가 이웃해 다시 나온 수(엔진은 처음 것을 쓴다). */
  duplicates: number;
  /** 돌 수 순서인가 — 주형을 한 번에 정할 수 있는가. */
  countOrdered: boolean;
  /** 해시할 수 없는 레코드(메타데이터 · 패스 칸 · 직사각 판). */
  special: number;
  indexSkipped?: "memory" | "alloc";
  openingsSkipped?: "unordered";
  /** 색인 배열의 바이트(색인을 했을 때). */
  indexBytes?: number;
  ms: { stats?: number; hash?: number; link?: number; roots?: number; total: number };
}

/** 레코드당 색인 바이트 — 위 표. */
export const INDEX_BYTES_PER_RECORD = 16;

/** 레코드 수 n 의 색인 메모리 추정(바이트) — 배열 + 통 표 + 비트맵 + 읽기 버퍼(약 4MB). */
export function indexBytesEstimate(n: number): number {
  return (
    n * INDEX_BYTES_PER_RECORD + 4 * (1 << bucketBits(n)) + (1 << bloomBits(n)) / 8 + (4 << 20)
  );
}

/**
 * 메모리 관문 — 이 기기에서 색인에 쓸 상한(바이트). `navigator.deviceMemory`(GB, 크롬은 0.25 ~ 8 로 뭉갠다;
 * 없으면 4 로 본다)의 1/16. 8GB → 512MB, 4GB → 256MB, 2GB → 128MB(표본 817만 국면 ≈ 143MB 는 건너뛴다).
 */
export function indexBudget(deviceMemoryGB: number | undefined): number {
  const gb = deviceMemoryGB && deviceMemoryGB > 0 ? deviceMemoryGB : 4;
  return Math.floor((gb * 1024 * 1024 * 1024) / 16);
}

/** 비트맵 크기(비트 수의 log2) — 레코드당 8비트 이상, 2의 거듭제곱. */
const bloomBits = (n: number): number =>
  Math.max(10, Math.min(31, Math.ceil(Math.log2(Math.max(n, 1) * 8))));

const bucketBits = (n: number): number =>
  Math.max(4, Math.min(22, Math.ceil(Math.log2(Math.max(n, 1))) - 3));

/** 렌주 · 표준 15줄만 26주형으로 나눈다(§5). */
const classifiable = (rule: number, w: number): boolean =>
  w === 15 && (rule === RULE_RENJU || rule === RULE_STANDARD);

const UNCLASSIFIED = NONSTD; // 26 — 표를 던지지 않는다
/** 부모들의 주형이 엇갈린 국면 — 색인 안에서만. 밖(분포 · `onClassified`)으로는 26 으로 접는다. */
const MIXED = 27;
const outward = (o: number): number => (o === MIXED ? UNCLASSIFIED : o);

/** 시작점: 가장 무거운 자식이 그 아래의 9/10 이상이면 내려간다(L5-6 결정 1). 정수로 — 앱과 같은 비교. */
const START_NUM = 9;
const START_DEN = 10;

export async function scanYxdb(blob: BlobLike, opts: ScanOptions = {}): Promise<ScanResult> {
  const t0 = performance.now();
  const wantIndex = opts.index ?? true;
  const rootsTop = opts.rootsTop ?? 32;
  const cancelled = () => opts.isCancelled?.() ?? false;
  // 단계별 몫: 색인이면 1차 0.45 · 2차 0.5 · 뿌리 0.05
  const span: Record<ScanPhase, [number, number]> = wantIndex
    ? { stats: [0, 1], hash: [0, 0.45], link: [0.45, 0.95], roots: [0.95, 1] }
    : { stats: [0, 1], hash: [0, 1], link: [0, 1], roots: [0, 1] };
  let lastPost = -1e9;
  let records = 0;
  const progress = (phase: ScanPhase, f: number) => {
    const now = performance.now();
    if (now - lastPost < 100 && f < 1) return; // 10Hz
    lastPost = now;
    const [a, b] = span[phase];
    opts.onProgress?.({ phase, fraction: a + (b - a) * Math.min(1, f), records });
  };

  // ── 1차 통과: 통계 (+ 해시) ──
  const stats: DbStats = {
    records: 0,
    rules: {},
    labels: { W: 0, L: 0, D: 0, other: 0 },
    commented: 0,
    indexVersion: INDEX_VERSION,
  };
  // 규칙 · 판(rule | w << 8 | h << 16)별 국면 수와 마지막 돌 수 — 엔진 파일은 같은 규칙이 이어지므로 지금
  // 묶음만 지역 변수로 세고, 묶음이 바뀔 때 Map 에 넣는다
  const ruleCount = new Map<number, number>();
  const lastN = new Map<number, number>();
  let curRk = -1;
  let curCount = 0;
  let curN = -1;
  const switchRule = (rk: number) => {
    if (curRk >= 0) {
      ruleCount.set(curRk, (ruleCount.get(curRk) ?? 0) + curCount);
      lastN.set(curRk, curN);
    }
    curRk = rk;
    curCount = 0;
    curN = rk >= 0 ? (lastN.get(rk) ?? -1) : -1;
  };
  let countOrdered = true;
  let sorted = true;
  let duplicates = 0;
  let special = 0;
  const prev = new Uint8Array(0x10000); // 키 길이는 u16
  let prevLen = -1;

  let index: Index | null = null;
  let indexSkipped: ScanResult["indexSkipped"];
  const hasher = new KeyHasher();
  let phase1: ScanPhase = wantIndex ? "hash" : "stats";

  const r1 = await readYxdb(
    blob,
    (b, ko, kl, vo, vl) => {
      // 엔진 키 순서 · 중복
      if (prevLen >= 0) {
        const c = compareYxdbKeys(prev, 0, prevLen, b, ko, kl);
        if (c > 0) sorted = false;
        else if (c === 0) duplicates++;
      }
      for (let k = 0; k < kl; k++) prev[k] = b[ko + k]!; // subarray() 는 레코드마다 객체를 만든다
      prevLen = kl;
      if (isMetaKey(b, ko, kl)) {
        special++;
        return;
      }
      records++;
      const rk = b[ko]! | (b[ko + 1]! << 8) | (b[ko + 2]! << 16);
      if (rk !== curRk) switchRule(rk);
      curCount++;
      const lab = valueLabel(b, vo, vl);
      if (lab === 0x77) stats.labels.W++;
      else if (lab === 0x6c) stats.labels.L++;
      else if (lab === 0x64) stats.labels.D++;
      else if (lab !== 0) stats.labels.other++;
      if (valueTextLength(vl) > 0) stats.commented++;

      if (!hasher.load(b, ko, kl)) {
        special++;
        return;
      }
      if (hasher.n < curN) countOrdered = false;
      curN = hasher.n;
      if (index) {
        hasher.hash();
        hasher.canon();
        index.add(hasher.hi, hasher.lo, hasher.n);
      }
    },
    {
      ...(opts.verify ? { verify: true } : {}),
      onCount: (n) => {
        // 레코드 수로 관문을 먼저 본다
        if (!wantIndex) return;
        if (opts.maxIndexBytes !== undefined && indexBytesEstimate(n) > opts.maxIndexBytes)
          indexSkipped = "memory";
        else
          try {
            index = new Index(n);
          } catch {
            indexSkipped = "alloc";
          }
        if (indexSkipped) {
          phase1 = "stats";
          span.stats = [0, 1];
        }
      },
      onChunk: (loaded, total) => progress(phase1, loaded / total),
      isCancelled: cancelled,
    },
  );

  switchRule(-1);
  stats.records = records;
  for (const [k, v] of ruleCount)
    stats.rules[ruleBoardName(k & 0xff, (k >>> 8) & 0xff, (k >>> 16) & 0xff)] = v;
  const tStats = performance.now();
  const ms: ScanResult["ms"] = { total: 0 };
  ms[wantIndex && index ? "hash" : "stats"] = tStats - t0;

  const base: ScanResult = {
    stats,
    count: r1.count,
    compressed: r1.compressed,
    rawBytes: r1.rawBytes,
    sorted,
    duplicates,
    countOrdered,
    special,
    ms,
  };
  if (indexSkipped) base.indexSkipped = indexSkipped;
  const idx = index as Index | null;
  if (!idx) {
    ms.total = performance.now() - t0;
    return base;
  }
  if (cancelled()) throw new YxdbCancelled();
  idx.sort();
  if (cancelled()) throw new YxdbCancelled();
  base.indexBytes = idx.bytes;

  // ── 2차 통과: 부모 · 주형 ── (슬롯 = 정렬된 해시 자리. 레코드 번호 대신 슬롯으로 적는다)
  const parent = idx.parent;
  const rootKeys = new Map<number, string>(); // 슬롯 → 키
  let rootKeyBytes = 0;
  let rootKeysDropped = false;
  const ROOT_KEY_CAP = opts.rootKeyCap ?? 8 << 20;
  let rec = -1; // 레코드 번호(특수 · 겹침까지 모두) — 뿌리는 parent 에 ~rec 로 적는다
  const counts = new Array<number>(OPENINGS + 1).fill(0);
  let classified = 0; // 렌주 · 표준 15줄 국면 수
  const qh = new Int32Array(1024);
  const ql = new Int32Array(1024);
  const qs = new Int32Array(1024);
  records = 0;
  const onCls = opts.onClassified;
  await readYxdb(
    blob,
    (b, ko, kl, vo, vl) => {
      rec++;
      if (!hasher.load(b, ko, kl)) {
        // 특수 — 색인에 없다
        onCls?.(b, ko, kl, vo, vl, isMetaKey(b, ko, kl) ? -1 : UNCLASSIFIED);
        return;
      }
      hasher.hash();
      hasher.canon();
      const own = idx.find(hasher.hi, hasher.lo);
      if (own < 0 || idx.visited(own)) {
        // 같은 국면이 또 — 처음 것만 센다
        onCls?.(b, ko, kl, vo, vl, own < 0 ? UNCLASSIFIED : outward(idx.openingOf(own)));
        return;
      }
      records++;
      const cls = classifiable(hasher.rule, hasher.w) && countOrdered;
      const n = hasher.n;
      let first = -1;
      let op = -1; // 부모들의 주형: -1 아직 없음
      if (!cls || n <= 3) {
        // 뿌리 · 부분 트리엔 첫 부모만 필요
        for (let k = hasher.lastFrom, to = hasher.lastTo; k < to && first < 0; k++) {
          hasher.without(k);
          first = idx.find(hasher.hi, hasher.lo);
        }
      } else {
        // 모든 부모 — 후보를 모아 한 번에 찾는다(캐시 미스를 겹친다)
        let q = 0;
        for (let k = hasher.lastFrom, to = hasher.lastTo; k < to; k++, q++) {
          hasher.without(k);
          qh[q] = hasher.hi;
          ql[q] = hasher.lo;
        }
        idx.findMany(qh, ql, q, qs);
        for (let k = 0; k < q; k++) {
          const j = qs[k]!;
          if (j < 0) continue;
          if (first < 0) first = j;
          const pj = idx.openingOf(j);
          if (pj === UNCLASSIFIED) continue; // 비표준 부모는 표가 없다
          if (pj === MIXED || (op !== -1 && pj !== op)) {
            op = MIXED;
            break;
          }
          op = pj;
        }
      }
      parent[own] = first < 0 ? ~rec : first;
      const o =
        !cls || n < 3 ? UNCLASSIFIED : n === 3 ? classifyKey(hasher) : op < 0 ? UNCLASSIFIED : op;
      idx.setOpening(own, o);
      onCls?.(b, ko, kl, vo, vl, outward(o));
      if (cls) {
        counts[outward(o)]!++;
        classified++;
      }
      if (first < 0 && !rootKeysDropped) {
        rootKeyBytes += kl * 2 + 32;
        if (rootKeyBytes > ROOT_KEY_CAP) {
          rootKeysDropped = true;
          rootKeys.clear();
        } else rootKeys.set(own, keyToHex(b, ko, kl));
      }
    },
    {
      onChunk: (loaded, total) => progress("link", loaded / total),
      isCancelled: cancelled,
    },
  );
  const tLink = performance.now();
  ms.link = tLink - tStats;

  // 주형 분포 — 렌주 · 표준 15줄 국면만
  if (!countOrdered) base.openingsSkipped = "unordered";
  else if (classified > 0) stats.openings = counts;

  // ── 부분 트리 · 뿌리 ── 돌 수 큰 쪽부터 첫 부모에 더한다(첫 부모는 돌이 하나 적다 — 파일 순서와 무관)
  const size = idx.subtreeSizes();
  const top: { s: number; size: number }[] = [];
  for (let sl = 0, m = idx.m; sl < m; sl++) {
    if (parent[sl]! >= 0 || !idx.visited(sl)) continue;
    const z = size(sl);
    if (top.length === rootsTop && z <= top[top.length - 1]!.size) continue;
    let i = top.length;
    while (i > 0 && top[i - 1]!.size < z) i--;
    top.splice(i, 0, { s: sl, size: z });
    if (top.length > rootsTop) top.pop();
  }
  // 뿌리 키 — 2차에서 모아 둔 것, 넘쳤으면 한 번 더 읽어 필요한 것만. 해시 표는 부분 트리 크기로 덮였으니
  // 찾기(`find`)는 못 쓴다 — 2차에서 parent 에 적어 둔 레코드 번호로 맞춘다
  if (rootKeysDropped && top.length > 0) {
    const want = new Map<number, number>(); // 레코드 번호 → 슬롯
    let last = 0;
    for (const t of top) {
      const r = ~parent[t.s]!;
      want.set(r, t.s);
      last = Math.max(last, r);
    }
    let at = -1;
    await readYxdb(
      blob,
      (b, ko, kl) => {
        at++;
        const sl = want.get(at);
        if (sl !== undefined) rootKeys.set(sl, keyToHex(b, ko, kl));
        if (at >= last) return false;
      },
      { onChunk: (loaded, total) => progress("roots", loaded / total), isCancelled: cancelled },
    );
  }
  // 시작점 — 뿌리와 다른 것만 키를 읽는다. 해시로 찾을 수 없으니(hi 칸 = 크기) 돌 수 · 해시 아래 반쪽 · 첫
  // 부모의 아래 반쪽을 맞춰 본다. 규칙 하나의 돌 수 순서 파일이면 그 돌 수를 지나는 곳에서 끝난다(규칙마다
  // 돌 수가 다시 시작한다)
  const ends = idx.heavyEnds(top.map((t) => t.s));
  const startKeys = new Map<number, string>();
  const wantStart = new Set(ends.filter((e, i) => e !== top[i]!.s));
  if (wantStart.size > 0) {
    const oneRuleOrdered = countOrdered && Object.keys(stats.rules).length <= 1;
    let maxN = 0;
    const wantNs = new Set<number>();
    for (const s of wantStart) {
      wantNs.add(idx.stonesOf(s));
      maxN = Math.max(maxN, idx.stonesOf(s));
    }
    await readYxdb(
      blob,
      (b, ko, kl) => {
        if (!hasher.load(b, ko, kl)) return;
        if (oneRuleOrdered && hasher.n > maxN) return false;
        if (!wantNs.has(hasher.n)) return;
        hasher.hash();
        hasher.canon();
        let hit = -1;
        for (const s of wantStart)
          if (idx.stonesOf(s) === hasher.n && idx.loOf(s) === hasher.lo) {
            hit = s;
            break;
          }
        if (hit < 0) return;
        const pl = idx.loOf(parent[hit]!);
        let parentOk = false;
        for (let k = hasher.lastFrom, to = hasher.lastTo; k < to && !parentOk; k++) {
          hasher.without(k);
          parentOk = hasher.lo === pl;
        }
        if (!parentOk) return;
        wantStart.delete(hit);
        startKeys.set(hit, keyToHex(b, ko, kl));
        if (wantStart.size === 0) return false;
      },
      { onChunk: (loaded, total) => progress("roots", loaded / total), isCancelled: cancelled },
    );
  }
  stats.roots = top.map((t, i) => {
    const root: DbRoot = { key: rootKeys.get(t.s) ?? "", subtree: t.size };
    const start = ends[i] !== t.s ? startKeys.get(ends[i]!) : undefined;
    if (start) root.start = start;
    return root;
  });
  progress("roots", 1);
  ms.roots = performance.now() - tLink;
  ms.total = performance.now() - t0;
  idx.release();
  return base;
}

/** 3돌 키 → 주형. 흑 둘 중 천원이 첫 수, 다른 흑이 셋째 수. */
function classifyKey(h: KeyHasher): number {
  const c0 = h.cells[0]!;
  const c1 = h.cells[1]!;
  const cw = h.cells[2]!;
  const ctr = (7 << 5) | 7;
  const other = c0 === ctr ? c1 : c1 === ctr ? c0 : -1;
  if (other < 0) return UNCLASSIFIED;
  return classify([move(7, 7), move(cw >> 5, cw & 31), move(other >> 5, other & 31)]);
}

// ── 색인 배열 ───────────────────────────────────────────────────────

const INFO_OPENING = 0xff; // 비트 0-7: 주형(0xFF = 아직)
const INFO_N_SHIFT = 8; // 비트 8-23: 돌 수
const INFO_VISITED = 1 << 24; // 2차 통과에서 정했다
const nOf = (info: number): number => (info >>> INFO_N_SHIFT) & 0xffff;

/**
 * 슬롯 배열 `[hi, lo, info] × m` — 해시로 정렬. 조회 한 번이 (통 표 다음) 한 캐시 줄이고, 부모의 주형도 같은
 * 줄에 있다 — 2차 통과는 거의 무작위 조회뿐이라 캐시 미스 수가 시간을 정한다. 부모는 슬롯 번호로 적는다.
 */
class Index {
  /** 해시한 레코드 수(특수 제외). */
  m = 0;
  private sl: Int32Array;
  readonly parent: Int32Array;
  private start: Uint32Array;
  private readonly shift: number;
  /**
   * 있을 수도 있는 해시의 비트맵(레코드당 8비트 → 거짓 양성 약 12%). 부모 후보의 94% 는 DB 에 없다(표본) —
   * 캐시에 드는 이 표가 조회 대부분을 메모리까지 가지 않고 끝낸다.
   */
  private bloom: Int32Array;
  private readonly bloomMask: number;

  constructor(n: number) {
    this.sl = new Int32Array(3 * n);
    this.parent = new Int32Array(n).fill(-1);
    const bits = bucketBits(n);
    this.shift = 32 - bits;
    this.start = new Uint32Array((1 << bits) + 1);
    const bb = bloomBits(n);
    this.bloom = new Int32Array(1 << (bb - 5));
    this.bloomMask = (1 << bb) - 1;
  }

  get bytes(): number {
    return (
      this.sl.byteLength + this.parent.byteLength + this.start.byteLength + this.bloom.byteLength
    );
  }

  private bloomIndex(h: number, l: number): number {
    return (l ^ Math.imul(h, 0x9e3779b1)) & this.bloomMask;
  }

  add(hi: number, lo: number, n: number): void {
    const o = 3 * this.m++;
    this.sl[o] = hi;
    this.sl[o + 1] = lo;
    this.sl[o + 2] = INFO_OPENING | (n << INFO_N_SHIFT);
    const bi = this.bloomIndex(hi, lo);
    this.bloom[bi >>> 5]! |= 1 << (bi & 31);
  }

  /** 없는 것이 확실하면 false. */
  mayHave(h: number, l: number): boolean {
    const bi = this.bloomIndex(h, l);
    return (this.bloom[bi >>> 5]! & (1 << (bi & 31))) !== 0;
  }

  visited(s: number): boolean {
    return (this.sl[3 * s + 2]! & INFO_VISITED) !== 0;
  }

  openingOf(s: number): number {
    return this.sl[3 * s + 2]! & INFO_OPENING;
  }

  setOpening(s: number, o: number): void {
    const i = 3 * s + 2;
    this.sl[i] = (this.sl[i]! & ~INFO_OPENING) | o | INFO_VISITED;
  }

  /**
   * **lo** 의 윗비트 통으로 제자리 분배(American flag sort) → 통 안 삽입 정렬, (hi, lo) 순(부호 있는 비교 —
   * `find` 와 같다). hi 는 8 변환의 최솟값이라 윗비트가 한쪽에 몰린다(Beta(1, 8)) — 그것으로 통을 나누면 통 크기가
   * 고르지 않아 조회가 몇 배 느렸다. 최솟값의 짝인 lo 는 고르다.
   */
  sort(): void {
    const { sl, shift, start } = this;
    const m = this.m;
    const nb = start.length - 1;
    const next = new Uint32Array(nb);
    for (let i = 0; i < m; i++) next[sl[3 * i + 1]! >>> shift]!++;
    let acc = 0;
    for (let b = 0; b < nb; b++) {
      start[b] = acc;
      acc += next[b]!;
      next[b] = start[b]!;
    }
    start[nb] = acc;
    for (let b = 0; b < nb; b++) {
      const end = start[b + 1]!;
      while (next[b]! < end) {
        const i = next[b]!;
        let h = sl[3 * i]!;
        let l = sl[3 * i + 1]!;
        let f = sl[3 * i + 2]!;
        let tb = l >>> shift;
        // 고리: 제자리를 찾을 때까지 밀어낸다
        while (tb !== b) {
          const j = 3 * next[tb]!++;
          const h2 = sl[j]!;
          const l2 = sl[j + 1]!;
          const f2 = sl[j + 2]!;
          sl[j] = h;
          sl[j + 1] = l;
          sl[j + 2] = f;
          h = h2;
          l = l2;
          f = f2;
          tb = l >>> shift;
        }
        sl[3 * i] = h;
        sl[3 * i + 1] = l;
        sl[3 * i + 2] = f;
        next[b]!++;
      }
    }
    for (let b = 0; b < nb; b++) {
      const s = start[b]!;
      const e = start[b + 1]!;
      for (let i = s + 1; i < e; i++) {
        const h = sl[3 * i]!;
        const l = sl[3 * i + 1]!;
        const f = sl[3 * i + 2]!;
        let j = i - 1;
        while (j >= s) {
          const hj = sl[3 * j]!;
          const lj = sl[3 * j + 1]!;
          if (hj < h || (hj === h && lj <= l)) break;
          sl[3 * j + 3] = hj;
          sl[3 * j + 4] = lj;
          sl[3 * j + 5] = sl[3 * j + 2]!;
          j--;
        }
        sl[3 * j + 3] = h;
        sl[3 * j + 4] = l;
        sl[3 * j + 5] = f;
      }
    }
  }

  /** 해시 → 슬롯(같은 국면이 여럿이면 앞 슬롯), 없으면 -1. */
  find(h: number, l: number): number {
    if (!this.mayHave(h, l)) return -1;
    const sl = this.sl;
    const b = l >>> this.shift;
    for (let i = this.start[b]!, e = this.start[b + 1]!; i < e; i++) {
      const hv = sl[3 * i]!;
      if (hv < h) continue;
      if (hv > h) return -1;
      const lv = sl[3 * i + 1]!;
      if (lv < l) continue;
      return lv === l ? i : -1;
    }
    return -1;
  }

  private readonly qb = new Int32Array(1024);
  private readonly qe = new Int32Array(1024);
  /** 미리 읽기 결과를 버리지 않으려고(최적화기가 지우지 않게) 담아 둔다. */
  touched = 0;

  /**
   * 여러 해시를 한 번에 — `out[k]` = 슬롯 또는 -1. 통 시작 읽기 · 첫 슬롯 읽기를 각각 한 루프로 몰아 서로
   * 기다리지 않게 한다(조회 하나는 의존 미스 둘이라, 하나씩 하면 메모리 지연이 그대로 쌓인다).
   */
  findMany(hs: Int32Array, ls: Int32Array, k: number, out: Int32Array): void {
    const { sl, start, shift, qb, qe } = this;
    for (let i = 0; i < k; i++) {
      if (!this.mayHave(hs[i]!, ls[i]!)) {
        qb[i] = qe[i] = 0;
        continue;
      }
      const b = ls[i]! >>> shift;
      qb[i] = start[b]!;
      qe[i] = start[b + 1]!;
    }
    let t = 0;
    for (let i = 0; i < k; i++) if (qb[i]! < qe[i]!) t ^= sl[3 * qb[i]!]!;
    this.touched ^= t;
    for (let i = 0; i < k; i++) {
      const h = hs[i]!;
      const l = ls[i]!;
      let r = -1;
      for (let j = qb[i]!, e = qe[i]!; j < e; j++) {
        const hv = sl[3 * j]!;
        if (hv < h) continue;
        if (hv > h) break;
        const lv = sl[3 * j + 1]!;
        if (lv < l) continue;
        if (lv === l) r = j;
        break;
      }
      out[i] = r;
    }
  }

  /** 돌 수 순서 목록(`subtreeSizes` 뒤, `heavyEnds` 까지). 못 잡았으면 null — 목록은 lo 칸에, 시작점은 없다. */
  private order: Int32Array | null = null;
  /** 돌 수 n 인 슬롯이 순서 목록의 [layer[n], layer[n + 1]) 에 있다. */
  private layer: Uint32Array | null = null;

  /**
   * 2차 통과 뒤 — 해시로는 더 찾지 않는다. hi 칸을 부분 트리 크기로 다시 써서 돌 수 큰 슬롯부터 첫 부모에
   * 더한다. 돌 수 순서 목록은 따로 잡는다(레코드당 4바이트, 비트맵을 놓은 자리) — lo 칸(해시 아래 반쪽)을 시작점
   * 키를 다시 읽을 때 맞춰 보려고 남긴다. 못 잡으면 lo 칸에 쓰고 시작점은 건너뛴다. 크기를 읽는 함수를 돌려준다.
   */
  subtreeSizes(): (s: number) => number {
    const { sl, parent } = this;
    const m = this.m;
    this.start = new Uint32Array(0);
    this.bloom = new Int32Array(0);
    let maxN = 0;
    for (let s = 0; s < m; s++) {
      sl[3 * s] = 1;
      maxN = Math.max(maxN, nOf(sl[3 * s + 2]!));
    }
    let order: Int32Array | null;
    try {
      order = new Int32Array(m);
    } catch {
      order = null;
    }
    // 돌 수로 셈 정렬
    const cnt = new Uint32Array(maxN + 2);
    for (let s = 0; s < m; s++) cnt[nOf(sl[3 * s + 2]!) + 1]!++;
    for (let k = 0; k <= maxN; k++) cnt[k + 1]! += cnt[k]!;
    const layer = cnt.slice();
    if (order) {
      for (let s = 0; s < m; s++) order[cnt[nOf(sl[3 * s + 2]!)]!++] = s;
      for (let k = m - 1; k >= 0; k--) {
        const s = order[k]!;
        const p = parent[s]!;
        if (p >= 0) sl[3 * p]! += sl[3 * s]!;
      }
      this.order = order;
      this.layer = layer;
    } else {
      for (let s = 0; s < m; s++) sl[3 * cnt[nOf(sl[3 * s + 2]!)]!++ + 1] = s;
      for (let k = m - 1; k >= 0; k--) {
        const s = sl[3 * k + 1]!;
        const p = parent[s]!;
        if (p >= 0) sl[3 * p]! += sl[3 * s]!;
      }
    }
    return (s) => sl[3 * s]! >>> 0;
  }

  /**
   * 뿌리마다 시작점 슬롯(`subtreeSizes` 뒤) — 첫 부모로 이은 자식 가운데 가장 무거운 것이 그 아래(자기 뺀 부분
   * 트리)의 `START_NUM / START_DEN` 이상인 동안 내려간다. 자식은 돌이 하나 많으니 한 층만 훑는다. 순서 목록이
   * 없으면 뿌리 그대로. 끝나면 목록을 놓는다.
   */
  heavyEnds(roots: readonly number[]): number[] {
    const ends = roots.slice();
    const { order, layer, sl, parent } = this;
    this.order = null;
    this.layer = null;
    if (!order || !layer) return ends;
    const size = (s: number) => sl[3 * s]! >>> 0;
    let active = roots.map((_, i) => i);
    while (active.length > 0) {
      const byNode = new Map<number, number[]>();
      for (const i of active) {
        const s = ends[i]!;
        const list = byNode.get(s);
        if (list) list.push(i);
        else byNode.set(s, [i]);
      }
      const layers = new Set<number>();
      for (const s of byNode.keys()) layers.add(nOf(sl[3 * s + 2]!) + 1);
      const best = new Map<number, number>();
      for (const n of layers) {
        if (n + 1 >= layer.length) continue;
        for (let k = layer[n]!, e = layer[n + 1]!; k < e; k++) {
          const c = order[k]!;
          const p = parent[c]!;
          if (p < 0 || !byNode.has(p)) continue;
          const b = best.get(p);
          if (b === undefined || size(c) > size(b) || (size(c) === size(b) && c < b))
            best.set(p, c);
        }
      }
      const next: number[] = [];
      for (const [s, is] of byNode) {
        const c = best.get(s);
        if (c === undefined || size(c) * START_DEN < (size(s) - 1) * START_NUM) continue;
        for (const i of is) {
          ends[i] = c;
          next.push(i);
        }
      }
      active = next;
    }
    return ends;
  }

  /** 해시 아래 반쪽(`subtreeSizes` 가 순서 목록을 따로 잡았을 때만 남는다). */
  loOf(s: number): number {
    return this.sl[3 * s + 1]!;
  }

  stonesOf(s: number): number {
    return nOf(this.sl[3 * s + 2]!);
  }

  release(): void {
    this.sl = new Int32Array(0);
  }
}
