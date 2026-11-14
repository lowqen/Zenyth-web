/**
 * 셸 실측 — 데스크톱 Z6(계획 §6 «기동» · «메모리»). CI 가 빌드한 `zenyth-desktop.exe` 를 실제로 띄워
 * 프로세스 → 셸 준비 → 웹 내비 시작 → 창 표시 → 첫 페인트를 나눠 재고, 웹뷰 프로세스 트리의 메모리를 잰다.
 * Windows 전용이고 CI 에는 걸지 않는다(창이 뜬다) — 개발 기기에서 산출물을 받아 돌린다.
 *
 *   gh run download -R lowqen/Zenyth-desktop <desktop.yml 실행> -D <폴더>
 *   pnpm exec tsx scripts/perf-shell.ts <폴더>/…/zenyth-desktop.exe [회수=3]
 *
 * - 시각은 셸의 `boot_marks`(main.rs — `main` 진입이 0)와 웹의 `performance.timeOrigin` 을 맞대 본다.
 *   창 표시는 `theme-init.js` 가 show 를 부른 시각(`__zenythShowAt`)이다 — 셸 대비책(5초)이 먼저면 `show-fallback`.
 * - 메모리는 셸 자식인 `msedgewebview2` 전부의 Private 합(공유 페이지를 겹쳐 세지 않는 쪽)과 렌더러 단독.
 *   엔진은 설정을 따른다: 네이티브(엔진 폴더 **복사본**을 exe 옆 `engine/` 에 — 운영 폴더 · DB 금지)면 엔진
 *   메모리는 웹뷰 밖이고, WASM 이면 렌더러 안에 해시 · 가중치가 든다.
 * - 웹뷰 프로필(%LOCALAPPDATA%\dev.gomoku.zenyth.desktop)은 평소 것을 그대로 쓴다 — 설정 · 첫 방문 여부가 결과에 든다.
 */
import { spawn, execFileSync } from "node:child_process";
import { chromium } from "playwright";

const EXE = process.argv[2];
const RUNS = Number(process.argv[3] ?? 3);
const PORT = 9333;
const SETTLE_MS = 15_000;
if (!EXE) {
  console.error("사용법: tsx scripts/perf-shell.ts <zenyth-desktop.exe> [회수]");
  process.exit(2);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const killAll = () => {
  try {
    execFileSync("taskkill", ["/F", "/T", "/IM", "zenyth-desktop.exe"], { stdio: "ignore" });
  } catch {
    /* 떠 있는 것이 없다 */
  }
};

/** 셸 pid 아래 웹뷰 프로세스들의 Private(MB) — 종류별. */
function webviewMemory(pid: number): { total: number; renderer: number; rows: string[] } {
  const ps = `
$all = Get-CimInstance Win32_Process
$tree = @(${pid}); $grew = $true
while ($grew) { $grew = $false; foreach ($c in $all) { if ($tree -contains $c.ParentProcessId -and -not ($tree -contains $c.ProcessId)) { $tree += $c.ProcessId; $grew = $true } } }
foreach ($c in $all | Where-Object { $tree -contains $_.ProcessId }) {
  $t = if ($c.CommandLine -match '--type=([a-z-]+)') { $matches[1] } else { 'main' }
  $g = Get-Process -Id $c.ProcessId -ErrorAction SilentlyContinue
  if ($g) { "$($c.Name)|$t|$([math]::Round($g.PrivateMemorySize64/1MB))|$([math]::Round($g.WorkingSet64/1MB))" }
}`;
  const out = execFileSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" });
  let total = 0;
  let renderer = 0;
  const rows: string[] = [];
  for (const line of out.trim().split(/\r?\n/)) {
    const [name, type, priv, ws] = line.split("|");
    if (!name) continue;
    rows.push(`${name.replace(".exe", "")}:${type} ${priv}/${ws}MB`);
    if (name !== "msedgewebview2.exe") continue;
    total += Number(priv);
    if (type === "renderer") renderer += Number(priv);
  }
  return { total, renderer, rows };
}

interface Run {
  setup: number;
  pageStart: number;
  shown: number;
  fallback: boolean;
  fcp: number;
  engine: string;
  webviewMB: number;
  rendererMB: number;
  rows: string[];
}

const runs: Run[] = [];
for (let i = 0; i < RUNS; i++) {
  killAll();
  await sleep(4000);
  const child = spawn(EXE, [], {
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
    },
    stdio: "ignore",
    detached: true,
  });
  await sleep(SETTLE_MS);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const page = browser.contexts()[0]!.pages()[0]!;
  const r = await page.evaluate(async () => {
    const w = window as unknown as {
      __zenythShowAt?: number;
      __TAURI_INTERNALS__: { invoke(cmd: string): Promise<unknown> };
    };
    const boot = (await w.__TAURI_INTERNALS__.invoke("boot_marks")) as {
      main_epoch_ms: number;
      marks: [string, number][];
    };
    return {
      boot,
      origin: performance.timeOrigin,
      showAt: w.__zenythShowAt ?? null,
      fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
      engine:
        document.querySelector('[data-k="engine-indicator"]')?.getAttribute("data-status") ?? "?",
    };
  });
  await browser.close();
  const mark = (n: string) => r.boot.marks.find(([k]) => k === n)?.[1] ?? NaN;
  // 웹 시각(내비 기준) → main 기준
  const nav = r.origin - r.boot.main_epoch_ms;
  const fallbackAt = mark("show-fallback");
  const webShow = r.showAt === null ? NaN : nav + r.showAt;
  const shown = Number.isNaN(fallbackAt) ? webShow : Math.min(fallbackAt, webShow || Infinity);
  const mem = webviewMemory(child.pid!);
  runs.push({
    setup: mark("setup"),
    pageStart: Math.round(nav),
    shown: Math.round(shown),
    fallback: !Number.isNaN(fallbackAt) && fallbackAt <= (webShow || Infinity),
    fcp: r.fcp === null ? NaN : Math.round(nav + r.fcp),
    engine: r.engine,
    webviewMB: mem.total,
    rendererMB: mem.renderer,
    rows: mem.rows,
  });
  const x = runs.at(-1)!;
  console.log(
    `${i + 1}회: 셸 준비 ${x.setup}ms · 내비 시작 ${x.pageStart}ms · 창 표시 ${x.shown}ms${x.fallback ? "(대비책)" : ""}` +
      ` · 첫 페인트 ${x.fcp}ms · 엔진 ${x.engine} · 웹뷰 Private ${x.webviewMB}MB(렌더러 ${x.rendererMB})`,
  );
  if (process.env.PERF_VERBOSE) console.log(`   ${x.rows.join(" · ")}`);
}
killAll();

const med = (k: keyof Run) => {
  const xs = runs.map((r) => r[k] as number).sort((a, b) => a - b);
  return xs[Math.floor(xs.length / 2)];
};
console.log(
  `\n중앙값: 창 표시 ${med("shown")}ms · 첫 페인트 ${med("fcp")}ms · 웹뷰 ${med("webviewMB")}MB(렌더러 ${med("rendererMB")}MB)`,
);
