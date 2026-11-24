/**
 * 라이브러리 L5 교차 골든 — 안드로이드(Kotlin) 코덱이 웹과 같은 통계를 내는지 고정한다(안드로이드
 * `docs/라이브러리-L5-설계.md` §8). 사이드카의 `stats` 를 두 앱이 서로 믿으려면 같아야 한다.
 *
 *   pnpm tsx bench/dbio/l5-golden.ts <출력 폴더>
 *
 * 만드는 것(모두 합성 — RenjuNet 자료 아님, 커밋해도 된다):
 * - `mixed.db`      렌주 15 의 여러 주형 가지 + 표준 15 · 자유 15 · 자유 20 국면, 엔진 키 순서, LZ4
 * - `unordered.db`  같은 레코드를 섞은 것(돌 수 순서가 아님 → 주형 건너뜀), 압축 안 함
 * - `orphans.db`    부모가 빠진 국면이 섞인 것(미분류 · 뿌리 여럿), LZ4
 * - `<이름>.json`   `scanYxdb` 결과(통계 + 순서 · 중복 · 특수)
 * - `classify3.txt` 천원 흑 + 백 한 점 + 흑 한 점의 모든 3돌 국면 주형(줄 = 백 칸, 글자 = 흑 칸, 0-9a-p · q = 미분류 · . = 겹침)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compareYxdbKeys, metaRecord, YxdbWriter } from "../../src/core/database/yxdbfile.ts";
import { scanYxdb } from "../../src/core/database/yxdbindex.ts";
import { keyOfMoves } from "../../src/core/database/yxdbkey.ts";
import { classify, representative } from "../../src/core/opening/opening26.ts";
import { move, type Move } from "../../src/core/model/move.ts";

const out = process.argv[2];
if (!out) throw new Error("출력 폴더를 주세요");
mkdirSync(out, { recursive: true });

// 결정적 난수(Math.imul — L3 의 교훈: double 곱은 아래 비트를 잃는다)
let seed = 0x5a454e59;
const rnd = (n: number): number => {
  seed = (Math.imul(seed, 1103515245) + 12345) | 0;
  return ((seed >>> 8) & 0xffffff) % n;
};

const keyHex = (k: Uint8Array) => Buffer.from(k).toString("hex");

/** 수순의 모든 앞부분 키(빈 판 포함). */
function prefixes(rule: number, w: number, moves: Move[], into: Map<string, Uint8Array>, from = 0) {
  for (let i = from; i <= moves.length; i++) {
    const k = keyOfMoves(rule, w, moves.slice(0, i));
    into.set(keyHex(k), k);
  }
}

/** 빈 칸 하나를 고른다. */
function freeCell(w: number, used: Move[]): Move {
  for (;;) {
    const m = move(rnd(w), rnd(w));
    if (!used.some((u) => u.x === m.x && u.y === m.y)) return m;
  }
}

function walk(start: Move[], w: number, depth: number): Move[] {
  const moves = start.slice();
  for (let i = 0; i < depth; i++) moves.push(freeCell(w, moves));
  return moves;
}

function value(i: number): Uint8Array {
  const kind = i % 7;
  const text = kind === 3 ? new TextEncoder().encode(`메모 ${i} — note`) : new Uint8Array(0);
  if (kind === 6) return new Uint8Array(0); // 기록 없음
  const v = new Uint8Array(5 + text.length);
  v[0] = [0x77, 0x6c, 0x64, 0x77, 0x61, 0x00][kind]!; // w l d w a(그 밖) 0(라벨 없음)
  new DataView(v.buffer).setInt16(1, (i % 400) - 200, true);
  new DataView(v.buffer).setInt16(3, (i % 60) << 2, true);
  v.set(text, 5);
  return v;
}

function writeDb(keys: Uint8Array[], compress: boolean): Uint8Array {
  const chunks: Uint8Array[] = [];
  const w = new YxdbWriter(keys.length + 1, (c) => chunks.push(c.slice()), { compress, blockKB: 64 });
  const meta = metaRecord();
  w.recordKV(meta.key, 0, meta.key.length, meta.value, 0, meta.value.length);
  keys.forEach((k, i) => {
    const v = value(i);
    w.recordKV(k, 0, k.length, v, 0, v.length);
  });
  w.finish();
  return Buffer.concat(chunks);
}

const sortKeys = (keys: Uint8Array[]) =>
  keys.slice().sort((a, b) => compareYxdbKeys(a, 0, a.length, b, 0, b.length));

// ── mixed: 렌주 주형 가지 + 다른 규칙 · 판 ──
const mixed = new Map<string, Uint8Array>();
for (let o = 0; o < 26; o++) {
  const branches = 1 + (o % 3);
  for (let b = 0; b < branches; b++) prefixes(2, 15, walk(representative(o), 15, 4 + rnd(9)), mixed);
}
// 3돌이 비표준(천원이 아닌 개시) — 미분류로 이어진다
prefixes(2, 15, walk([move(3, 3)], 15, 6), mixed);
// 표준 15(분류 대상) · 자유 15 · 자유 20(분류 밖, 뿌리만)
for (let b = 0; b < 3; b++) prefixes(1, 15, walk(representative(rnd(26)), 15, 6 + rnd(6)), mixed);
for (let b = 0; b < 3; b++) prefixes(0, 15, walk([move(7, 7)], 15, 5 + rnd(8)), mixed);
for (let b = 0; b < 2; b++) prefixes(0, 20, walk([move(9, 9)], 20, 5 + rnd(6)), mixed);
const mixedKeys = sortKeys([...mixed.values()]);

// ── orphans: 가지 중간을 빼서 부모가 없는 국면들 ──
const orphans = new Map<string, Uint8Array>();
for (let o = 0; o < 26; o += 2) {
  const moves = walk(representative(o), 15, 8);
  prefixes(2, 15, moves.slice(0, 4), orphans);
  prefixes(2, 15, moves, orphans, 6); // 5돌이 빠진다 → 6돌부터 뿌리
}
const orphanKeys = sortKeys([...orphans.values()]);

// ── unordered: mixed 를 섞는다 ──
const shuffled = mixedKeys.slice();
for (let i = shuffled.length - 1; i > 0; i--) {
  const j = rnd(i + 1);
  [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
}

async function emit(name: string, keys: Uint8Array[], compress: boolean) {
  const bytes = writeDb(keys, compress);
  writeFileSync(join(out, `${name}.db`), bytes);
  const r = await scanYxdb(new Blob([bytes]));
  const golden = {
    stats: r.stats,
    count: r.count,
    compressed: r.compressed,
    sorted: r.sorted,
    duplicates: r.duplicates,
    countOrdered: r.countOrdered,
    special: r.special,
    openingsSkipped: r.openingsSkipped ?? null,
  };
  writeFileSync(join(out, `${name}.json`), JSON.stringify(golden, null, 1) + "\n");
  console.log(`${name}: ${keys.length} 국면 · ${bytes.length} B · 뿌리 ${r.stats.roots?.length ?? 0}`);
}

await emit("mixed", mixedKeys, true);
await emit("unordered", shuffled, false);
await emit("orphans", orphanKeys, true);

// ── classify3: 천원 흑 + 백 c + 흑 d ──
const CH = "0123456789abcdefghijklmnopq";
const lines: string[] = [];
for (let c = 0; c < 225; c++) {
  let line = "";
  for (let d = 0; d < 225; d++) {
    const wc = move(c % 15, Math.floor(c / 15));
    const bd = move(d % 15, Math.floor(d / 15));
    const clash = c === 112 || d === 112 || c === d;
    line += clash ? "." : CH[classify([move(7, 7), wc, bd])]!;
  }
  lines.push(line);
}
writeFileSync(join(out, "classify3.txt"), lines.join("\n") + "\n");
console.log("classify3: 225 × 225");
