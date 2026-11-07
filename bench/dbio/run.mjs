#!/usr/bin/env node
/**
 * DB I/O 벤치 — yixindb 의 적재 · 저장 · 탐색 중 저장 · 저장 도중 강제 종료를 같은 절차로 잰다.
 * docs/engineering-notes.md §9. 엔진 패치(tools/patches/db1-*.patch) 전후를 같은 DB 로 비교한다.
 *
 *   node bench/dbio/run.mjs --engine <pbrain-rapfi(.exe)> --cwd <config.toml 이 있는 폴더> --db <샘플.db> \
 *        [--work <작업 폴더>] [--runs 3] [--kills 5] [--threads 2] [--label base] [--out results/x.json]
 *
 * 엔진 폴더의 config.toml 은 `[database] type = "yixindb"` 여야 한다(DB 는 YXSETDATABASE 로 붙인다).
 * 샘플은 매번 작업 폴더로 복사해서 쓴다 — 원본은 건드리지 않는다. 결과는 요약 몇 줄만 찍는다.
 *
 * 재는 것
 *   load   YXSETDATABASE → "DATABASE LOAD DONE" 까지(벽시계), 적재 직후 · 최대 메모리
 *   save   편집 한 건으로 dirty 를 만든 뒤 YXSAVEDATABASE → "Saved database file using N ms"
 *   stall  YXNBEST 분석 중 YXSAVEDATABASE — 처리되는지(응답), 분석이 살아 있는지(YXSTOP 뒤 수가 오는지)
 *   kill   저장 도중 정해진 시점(저장 시간의 10·30·50·70·90%)에 프로세스를 죽이고 남은 파일이 온전한지
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Engine, LIVE } from "../sprt/engine.mjs";
import { checkYxdb } from "./yxdb.mjs";

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.lastIndexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const P = {
  engine: opt("engine"),
  cwd: opt("cwd"),
  db: opt("db"),
  work: resolve(opt("work", join(tmpdir(), "dbio-bench"))),
  runs: Number(opt("runs", 3)),
  kills: Number(opt("kills", 5)),
  threads: Number(opt("threads", 2)),
  label: opt("label", "run"),
  out: opt("out"),
  loadTimeoutMs: Number(opt("load-timeout", 15 * 60_000)),
};
if (!P.engine || !P.db) {
  console.error("사용법: --engine <엔진> --db <샘플.db> [--cwd <엔진 폴더>] — 머리 주석 참고");
  process.exit(2);
}
P.engine = resolve(P.engine);
P.db = resolve(P.db);
P.cwd = resolve(P.cwd ?? dirname(P.engine));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mb = (bytes) => (bytes == null ? null : Math.round(bytes / 1048576));

/** 프로세스 메모리(바이트) — 윈도는 작업 집합 · 최대 작업 집합, 리눅스는 VmRSS · VmHWM. */
function memoryOf(pid) {
  try {
    if (process.platform === "win32") {
      const out = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `$p=Get-Process -Id ${pid}; "$($p.WorkingSet64) $($p.PeakWorkingSet64)"`,
        ],
        { encoding: "utf8", windowsHide: true },
      ).trim();
      const [rss, peak] = out.split(/\s+/).map(Number);
      return { rss, peak };
    }
    const s = readFileSync(`/proc/${pid}/status`, "utf8");
    const kb = (k) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(s)?.[1]) * 1024;
    return { rss: kb("VmRSS"), peak: kb("VmHWM") };
  } catch {
    return { rss: null, peak: null };
  }
}

function freshCopy(tag) {
  const dir = join(P.work, tag);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "bench.db");
  copyFileSync(P.db, path);
  return path;
}

async function boot(dbPath) {
  const eng = new Engine({ name: P.label, cmd: P.engine, cwd: P.cwd, startTimeoutMs: 120_000 });
  await eng.start({ rule: 4, info: [`INFO THREAD_NUM ${P.threads}`] });
  const t0 = performance.now();
  const done = eng.waitFor((l) => /DATABASE LOAD DONE/i.test(l), P.loadTimeoutMs, "DB 적재");
  done.catch(() => {});
  await eng.send(`YXSETDATABASE ${dbPath}`);
  await done;
  const loadMs = performance.now() - t0;
  return { eng, loadMs, mem: memoryOf(eng.child.pid) };
}

/** 구석 한 칸의 값을 바꿔 dirty 를 만든다 — 샘플 DB 의 국면과 겹치지 않는 자리. */
async function touch(eng, value) {
  const one = eng.waitFor((l) => /DATABASE ONE/i.test(l), 10_000, "편집 확인");
  one.catch(() => {});
  await eng.send(`YXEDITTVDDATABASE 2 0 ${value} 1\n0,0\nDONE`);
  await one.catch(() => null);
}

/** 저장하고, 저장 직후 보낸 ABOUT 이 언제 답하는지도 잰다(저장이 명령 처리를 막는 시간). */
async function save(eng, timeoutMs, { probe = false } = {}) {
  const t0 = performance.now();
  const reply = eng.waitFor((l) => /Saved database file using/i.test(l), timeoutMs, "DB 저장");
  reply.catch(() => {});
  await eng.send("YXSAVEDATABASE");
  let aboutMs = null;
  if (probe) {
    const about = eng.waitFor((l) => /name\s*=/i.test(l), timeoutMs, "저장 중 ABOUT");
    about.catch(() => {});
    await eng.send("ABOUT");
    await about;
    aboutMs = performance.now() - t0;
  }
  const line = await reply;
  return {
    wallMs: performance.now() - t0,
    engineMs: Number(/using (\d+) ms/i.exec(line)?.[1]),
    aboutMs,
  };
}

const results = {
  label: P.label,
  engine: P.engine,
  db: basename(P.db),
  runs: [],
  stall: null,
  kills: [],
};
const original = checkYxdb(P.db);
if (!original.ok) {
  console.error(`샘플 DB 가 온전하지 않습니다: ${original.error}`);
  process.exit(1);
}
results.records = original.records;
console.log(`[${P.label}] 샘플 ${basename(P.db)}: ${original.records.toLocaleString()} 국면`);

try {
  // ── load · save ─────────────────────────────────────────────
  for (let r = 0; r < P.runs; r++) {
    const path = freshCopy(`run${r}`);
    const { eng, loadMs, mem } = await boot(path);
    await touch(eng, 100 + r);
    const s = await save(eng, P.loadTimeoutMs, { probe: true });
    const after = memoryOf(eng.child.pid);
    eng.child.kill("SIGKILL"); // END 는 종료 저장을 부른다 — 재는 대상이 아니다
    await eng.exited;
    const check = checkYxdb(path);
    const run = {
      loadMs: Math.round(loadMs),
      saveWallMs: Math.round(s.wallMs),
      saveEngineMs: s.engineMs,
      commandBlockedMs: Math.round(s.aboutMs),
      rssAfterLoadMB: mb(mem.rss),
      peakMB: mb(after.peak),
      // 편집한 칸이 이미 있으면(앞 저장본을 샘플로 쓸 때) 국면 수는 그대로다
      savedOk:
        check.ok && check.records >= original.records && check.records <= original.records + 1,
      savedRecords: check.ok ? check.records : check.error,
      leftovers: readdirSync(dirname(path)).sort(),
    };
    results.runs.push(run);
    console.log(
      `  run${r}: 적재 ${run.loadMs}ms · 저장 ${run.saveWallMs}ms(엔진 ${run.saveEngineMs}ms) · ` +
        `저장 중 명령 대기 ${run.commandBlockedMs}ms · ` +
        `적재 후 ${run.rssAfterLoadMB}MB · 최대 ${run.peakMB}MB · 저장 파일 ${run.savedOk ? "정상" : `이상(${run.savedRecords})`}`,
    );
  }
  const saveWall = Math.max(...results.runs.map((r) => r.saveWallMs));

  // ── stall: 분석 중 저장 ───────────────────────────────────────
  {
    const path = freshCopy("stall");
    const { eng } = await boot(path);
    await touch(eng, 77);
    await eng.send("INFO TIMEOUT_TURN 3600000");
    await eng.send("INFO MAX_NODE 0");
    await eng.send("YXBOARD\n7,7,1\n8,8,2\n7,8,1\nDONE");
    let moveDuringSave = false;
    const untap = eng.tap((l) => {
      if (/^\d+\s*,\s*\d+$/.test(l)) moveDuringSave = true;
    });
    await eng.send("YXNBEST 1");
    await sleep(1500);
    let saved = null;
    try {
      saved = await save(eng, saveWall * 3 + 10_000);
    } catch {
      saved = null;
    }
    await sleep(1000);
    untap();
    const stillThinking = !moveDuringSave;
    const move = eng.waitFor((l) => /^\d+\s*,\s*\d+$/.test(l), 30_000, "YXSTOP 뒤 수");
    move.catch(() => {});
    await eng.send("YXSTOP");
    const gotMove = await move.then(
      () => true,
      () => false,
    );
    eng.child.kill("SIGKILL");
    await eng.exited;
    results.stall = {
      saveHandled: saved !== null,
      saveWallMs: saved ? Math.round(saved.wallMs) : null,
      analysisSurvived: stillThinking && gotMove,
    };
    console.log(
      `  stall: 분석 중 저장 ${saved ? `처리됨(${Math.round(saved.wallMs)}ms)` : "무시됨(응답 없음)"} · ` +
        `분석 ${results.stall.analysisSurvived ? "계속됨" : "끊김"}`,
    );
  }

  // ── kill: 저장 도중 강제 종료 ──────────────────────────────────
  const fractions = [0.1, 0.3, 0.5, 0.7, 0.9].slice(0, P.kills);
  for (const f of fractions) {
    const path = freshCopy(`kill${Math.round(f * 100)}`);
    const { eng } = await boot(path);
    await touch(eng, 55);
    await eng.send("YXSAVEDATABASE");
    await sleep(Math.round(saveWall * f));
    eng.child.kill("SIGKILL");
    await eng.exited;
    const main = checkYxdb(path);
    const bak = join(dirname(path), "bench_bak1.db");
    const backup = existsSync(bak) ? checkYxdb(bak) : null;
    const k = {
      at: f,
      mainOk:
        main.ok && (main.records === original.records || main.records === original.records + 1),
      main: main.ok ? main.records : main.error,
      backupOk: backup ? backup.ok : null,
      files: readdirSync(dirname(path)).sort(),
    };
    results.kills.push(k);
    console.log(
      `  kill@${Math.round(f * 100)}%: 본 파일 ${k.mainOk ? "정상" : `깨짐(${k.main})`} · ` +
        `백업 ${k.backupOk == null ? "없음" : k.backupOk ? "정상" : "깨짐"} · [${k.files.join(", ")}]`,
    );
  }
} finally {
  for (const e of LIVE) e.child?.kill("SIGKILL");
}

const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
results.summary = {
  loadMs: med(results.runs.map((r) => r.loadMs)),
  saveMs: med(results.runs.map((r) => r.saveWallMs)),
  commandBlockedMs: med(results.runs.map((r) => r.commandBlockedMs)),
  peakMB: med(results.runs.map((r) => r.peakMB)),
  stall: results.stall,
  killCorrupt: results.kills.filter((k) => !k.mainOk).length,
};
console.log(
  `[${P.label}] 중앙값 적재 ${results.summary.loadMs}ms · 저장 ${results.summary.saveMs}ms · ` +
    `저장 중 명령 대기 ${results.summary.commandBlockedMs}ms · 최대 ${results.summary.peakMB}MB · ` +
    `강제 종료 ${results.kills.length}회 중 본 파일 깨짐 ${results.summary.killCorrupt}회`,
);
if (P.out) {
  mkdirSync(dirname(resolve(P.out)), { recursive: true });
  writeFileSync(resolve(P.out), JSON.stringify(results, null, 1) + "\n");
}
