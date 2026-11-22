/**
 * 라이브러리 L0 — 엔진이 JS LZ4(`YxdbWriter`)로 다시 쓴 파일을 원본과 같게 읽는가. 두 파일을 작업 폴더에 복사해
 * 차례로 YXSETDATABASE 하고, 적재한 레코드 수와 국면 몇 개의 질의 답(줄 순서 무관)을 견준다.
 *
 *   node bench/dbio/library-engine-check.mjs <엔진> <config.toml 폴더> <원본.db> <다시쓴.db> <작업 폴더>
 *
 * 다시 쓴 파일은 `library-bench.ts write` 로 만든다. 엔진은 닫을 때 저장할 수 있으므로 원본을 직접 붙이지 않는다.
 */
import { copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Engine } from "../sprt/engine.mjs";

const [engPath, cwd, orig, rewrite, work] = process.argv.slice(2);
const queries = [
  [],
  [[7, 7]],
  [
    [7, 7],
    [7, 6],
  ],
  [
    [7, 7],
    [7, 6],
    [5, 9],
  ],
];

async function answers(db) {
  const eng = new Engine({
    name: "chk",
    cmd: resolve(engPath),
    cwd: resolve(cwd),
    startTimeoutMs: 120_000,
  });
  await eng.start({ rule: 4, info: ["INFO THREAD_NUM 1"] });
  const lines = [];
  eng.tap((l) => lines.push(l));
  const done = eng.waitFor((l) => /DATABASE LOAD DONE/i.test(l), 600_000, "적재");
  await eng.send(`YXSETDATABASE ${db}`);
  await done;
  await new Promise((r) => setTimeout(r, 500));
  console.log(lines.filter((l) => /Loaded/i.test(l)).join("\n"));
  const out = [];
  for (const q of queries) {
    const start = lines.length;
    const fin = eng.waitFor((l) => /DATABASE DONE/i.test(l), 30_000, "질의");
    await eng.send(["yxquerydatabaseallt", ...q.map(([x, y]) => `${x},${y}`), "done"].join("\n"));
    await fin;
    await new Promise((r) => setTimeout(r, 300));
    out.push(
      lines
        .slice(start)
        .filter((l) => /DATABASE/i.test(l) && !/Loaded/i.test(l))
        .sort()
        .join("\n"),
    );
  }
  const errs = lines.filter((l) => /error|corrupt/i.test(l));
  await eng.stop();
  return { out, errs };
}

const a = join(work, "a.db");
const b = join(work, "b.db");
copyFileSync(orig, a);
copyFileSync(rewrite, b);
const A = await answers(a);
const B = await answers(b);
let same = 0;
A.out.forEach((x, i) => {
  if (x === B.out[i]) same++;
  else
    console.log(
      `다름 #${i}\n--- 원본\n${x.slice(0, 400)}\n--- 다시 쓴 것\n${B.out[i].slice(0, 400)}`,
    );
});
console.log(
  `질의 ${queries.length}개 중 같음 ${same} · 줄 수 ${A.out.map((x) => x.split("\n").length).join(",")} · 오류 원본 ${A.errs.length} / 다시 쓴 것 ${B.errs.length}`,
);
if (B.errs.length) console.log(B.errs.slice(0, 3).join("\n"));
