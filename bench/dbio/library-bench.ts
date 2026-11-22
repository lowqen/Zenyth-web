/**
 * 라이브러리 L0 벤치 — `core/database/yxdbfile.ts` 스트리밍 코덱 · `yxdbindex.ts` 색인을 실제 yixindb 로 잰다.
 * docs/라이브러리-계획.md §8. 단계마다 따로 띄워야 최대 메모리가 섞이지 않는다.
 *
 *   pnpm tsx bench/dbio/library-bench.ts verify <db>          엔진이 쓴 파일과 바이트 · 레코드 대조, 키 정규화 대조
 *   node --expose-gc --import tsx bench/dbio/library-bench.ts scan <db> [stats]   통계(+색인) 시간 · 최대 메모리
 *   pnpm tsx bench/dbio/library-bench.ts write <db> <out.db>  JS LZ4 로 다시 쓰기 — 속도 · 크기, 다시 읽어 대조
 *   (엔진이 그 파일을 읽는지는 library-engine-check.mjs)
 *
 * 결과는 요약 몇 줄만 찍는다. 표본은 커밋하지 않는다(test-yixin/docs/개발_핸드북.md §13.1).
 */
import { createHash } from "node:crypto";
import { openAsBlob, readFileSync, createWriteStream } from "node:fs";
import { lz4FrameDecode } from "./yxdb.mjs";
import { readYxdb, YxdbWriter } from "../../src/core/database/yxdbfile.ts";
import { scanYxdb, indexBytesEstimate } from "../../src/core/database/yxdbindex.ts";
import { canonicalKey, decodeKey } from "../../src/core/database/yxdbkey.ts";
import { label as moveLabel } from "../../src/core/model/move.ts";

const mb = (n: number) => (n / 1048576).toFixed(1);
const s = (ms: number) => (ms / 1000).toFixed(2) + "s";

let peakRss = 0;
let peakAb = 0;
const sampler = setInterval(() => {
  const m = process.memoryUsage();
  peakRss = Math.max(peakRss, m.rss);
  peakAb = Math.max(peakAb, m.arrayBuffers);
}, 50);
const sampleNow = () => {
  const m = process.memoryUsage();
  peakRss = Math.max(peakRss, m.rss);
  peakAb = Math.max(peakAb, m.arrayBuffers);
};

/** 레코드를 다시 직렬화한 해시 — 원래 풀린 바이트의 해시와 같아야 한다(파서 검증). */
function recordHasher() {
  const h = createHash("sha256");
  const two = Buffer.alloc(2);
  return {
    head(n: number) {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(n);
      h.update(b);
    },
    rec(b: Uint8Array, ko: number, kl: number, vo: number, vl: number) {
      two.writeUInt16LE(kl);
      h.update(two);
      h.update(b.subarray(ko, ko + kl));
      two.writeUInt16LE(vl);
      h.update(two);
      h.update(b.subarray(vo, vo + vl));
    },
    digest: () => h.digest("hex"),
  };
}

async function verify(path: string) {
  const t0 = performance.now();
  const ref = lz4FrameDecode(readFileSync(path));
  const refHash = createHash("sha256").update(ref).digest("hex");
  const tRef = performance.now();
  console.log(`기준(yxdb.mjs 통째 해제) ${mb(ref.length)}MB ${s(tRef - t0)}`);

  // 스트리밍: 체크섬 확인 + 레코드 재직렬화 해시
  const rh = recordHasher();
  let count = 0;
  let headDone = false;
  let canonOk = 0;
  let canonBad = 0;
  let canonSkip = 0;
  const r = await readYxdb(
    await openAsBlob(path),
    (b, ko, kl, vo, vl, i) => {
      if (!headDone) {
        rh.head(count);
        headDone = true;
      }
      rh.rec(b, ko, kl, vo, vl);
      if (i % 16 === 0) {
        const key = b.slice(ko, ko + kl);
        const d = decodeKey(key);
        if (!d || d.pass || d.w !== d.h || d.w === 0) {
          canonSkip++;
          return;
        }
        const c = canonicalKey(d.rule, d.w, d.black, d.white);
        if (Buffer.compare(Buffer.from(c), Buffer.from(key)) === 0) canonOk++;
        else if (canonBad++ < 3)
          console.log(
            `  키 다름 #${i}: ${[...key].join(",")} / ${[...c].join(",")} (${d.black.map((m) => moveLabel(m)).join(" ")})`,
          );
      }
    },
    { verify: true, onCount: (n) => (count = n) },
  );
  const tStream = performance.now();
  const same = rh.digest() === refHash && r.rawBytes === ref.length;
  console.log(
    `스트리밍 ${s(tStream - tRef)} · 레코드 ${r.read}/${r.count} · 풀린 ${mb(r.rawBytes)}MB · 남은 ${r.trailing}B · LZ4 내용 체크섬 OK`,
  );
  console.log(`레코드 재직렬화 해시 = 기준 해시: ${same ? "같음" : "다름"}`);
  console.log(`키 정규화(16개마다) 같음 ${canonOk} · 다름 ${canonBad} · 건너뜀 ${canonSkip}`);
  if (!same || canonBad) process.exitCode = 1;
}

async function scan(path: string, statsOnly: boolean) {
  global.gc?.();
  sampleNow();
  const base = process.memoryUsage();
  const blob = await openAsBlob(path);
  const r = await scanYxdb(blob, { index: !statsOnly });
  sampleNow();
  clearInterval(sampler);
  const st = r.stats;
  console.log(
    JSON.stringify({
      mode: statsOnly ? "stats" : "index",
      records: st.records,
      count: r.count,
      sorted: r.sorted,
      countOrdered: r.countOrdered,
      duplicates: r.duplicates,
      special: r.special,
      rules: st.rules,
      labels: st.labels,
      commented: st.commented,
      indexMB: r.indexBytes ? +mb(r.indexBytes) : null,
      estimateMB: +mb(indexBytesEstimate(r.count)),
      ms: Object.fromEntries(Object.entries(r.ms).map(([k, v]) => [k, Math.round(v as number)])),
      baseRssMB: +mb(base.rss),
      peakRssMB: +mb(peakRss),
      peakArrayBuffersMB: +mb(peakAb),
    }),
  );
  if (st.openings) {
    const tot = st.openings.reduce((a, b) => a + b, 0);
    console.log(
      `주형: 분류 ${tot - st.openings[26]!} · 미분류 ${st.openings[26]} (${((100 * st.openings[26]!) / tot).toFixed(1)}%) — ` +
        st.openings
          .slice(0, 26)
          .map((v, i) => `${i < 13 ? "D" : "I"}${(i % 13) + 1}:${v}`)
          .filter((x) => !x.endsWith(":0"))
          .join(" "),
    );
  }
  if (st.roots) {
    const roots = st.roots;
    const sum = roots.reduce((a, b) => a + b.subtree, 0);
    console.log(
      `뿌리 상위 ${roots.length}: ` +
        roots
          .slice(0, 8)
          .map((x) => `${(x.key.length - 6) / 4}돌·${x.subtree}`)
          .join(" ") +
        ` … (상위 합 ${sum})`,
    );
  }
}

async function write(path: string, out: string) {
  const t0 = performance.now();
  const blob = await openAsBlob(path);
  // 레코드 수를 먼저 안다(머리)
  let count = 0;
  await readYxdb(blob, () => false, { onCount: (n) => (count = n) });
  const ws = createWriteStream(out);
  const pending: Uint8Array[] = [];
  const writer = new YxdbWriter(count, (c) => pending.push(c));
  const rhIn = recordHasher();
  rhIn.head(count);
  let lz4Ms = 0;
  await readYxdb(
    blob,
    (b, ko, kl, vo, vl) => {
      rhIn.rec(b, ko, kl, vo, vl);
      const a = performance.now();
      writer.record(b, ko, kl, vo, vl);
      lz4Ms += performance.now() - a;
    },
    {
      onChunk: () => {
        for (const c of pending.splice(0)) ws.write(c);
      },
    },
  );
  const a = performance.now();
  writer.finish();
  lz4Ms += performance.now() - a;
  for (const c of pending.splice(0)) ws.write(c);
  await new Promise<void>((res) => ws.end(res));
  const tWrite = performance.now();
  const inSize = blob.size;
  const outSize = writer.outBytes;
  console.log(
    `JS LZ4 다시 쓰기 ${s(tWrite - t0)} (압축기 몫 ${s(lz4Ms)}) · 원본(엔진 LZ4-HC) ${mb(inSize)}MB → ${mb(outSize)}MB (${((outSize / inSize) * 100).toFixed(0)}%)`,
  );
  // 다시 읽어 대조
  const rhOut = recordHasher();
  rhOut.head(count);
  const r = await readYxdb(
    await openAsBlob(out),
    (b, ko, kl, vo, vl) => rhOut.rec(b, ko, kl, vo, vl),
    {
      verify: true,
    },
  );
  const same = rhIn.digest() === rhOut.digest() && r.read === count;
  console.log(
    `다시 읽기 ${s(performance.now() - tWrite)} · 레코드 ${r.read}/${count} · 대조 ${same ? "같음" : "다름"}`,
  );
  if (!same) process.exitCode = 1;
}

const [cmd, a, b] = process.argv.slice(2);
const run =
  cmd === "verify"
    ? verify(a!)
    : cmd === "scan"
      ? scan(a!, b === "stats")
      : cmd === "write"
        ? write(a!, b!)
        : Promise.reject(new Error("사용: verify <db> | scan <db> [stats] | write <db> <out>"));
run
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => clearInterval(sampler));
