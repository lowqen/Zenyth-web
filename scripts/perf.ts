/**
 * 성능 측정 — 데스크톱 Z6(계획 §6 «측정»). 빌드된 `dist/` 를 데스크톱 배치(`:root[data-desktop]`, 1440×900)로 띄워
 * 같은 시나리오를 자동으로 재생하고, §6 의 목표치와 견준다.
 *
 *   pnpm build && pnpm exec tsx scripts/perf.ts            # 측정 + 목표 검사(넘으면 종료 코드 1)
 *   PERF_BUDGET=off pnpm exec tsx scripts/perf.ts          # 측정만(느린 개발 기기)
 *   PERF_OUT=perf.json pnpm exec tsx scripts/perf.ts       # 결과를 JSON 으로도 남긴다(CI 아티팩트)
 *
 * 시나리오(같은 순서 · 같은 국면):
 *   1. 기동     — 새 문맥에서 `/board` 를 열어 첫 페인트 · 판이 그려진 시각 · 그때까지 받은 JS 바이트(3회 중앙값)
 *   2. 조작     — 30수 기보를 열고 ← 30번 · → 30번(리뷰 넘기기), 빈 판에 키보드로 10수 두기.
 *                 손짓마다 «처리 시간»(입력 → 동기 처리 끝: React 커밋 · 판 그리기 포함)과 «다음 프레임까지».
 *                 프레임 값은 참고만 한다 — 헤드리스 Chromium 은 GPU 없이 캔버스를 타일로 소프트웨어 래스터해서
 *                 착수 한 번에 수십 ms 가 붙는다(GPU 합성인 WebView2 에는 없는 비용, 계획서 §9.10)
 *   3. 분석     — 실제 엔진(WASM)으로 10초 분석하며 메인 스레드 점유율(CDP TaskDuration), 프레임 수,
 *                 **리렌더 범위**(분석 중 다시 그려진 컴포넌트가 캡슐 · 인스펙터 · 판 밖에 있는가), 분석 중 착수 처리 시간
 *   4. 메모리   — 분석 뒤 페이지 전체(워커 · WASM 포함, `measureUserAgentSpecificMemory`)와 JS 힙
 *
 * 리렌더 범위는 React DevTools 훅 자리(`__REACT_DEVTOOLS_GLOBAL_HOOK__`)에 작은 집계기를 심어 잰다 — 프로덕션 번들도
 * 커밋마다 이 훅을 부른다. 이름은 압축돼 있으므로 컴포넌트를 **그것이 그린 첫 DOM 요소**로 부르고, 그 요소가
 * 어느 영역(`.capsule` · `.inspector` · `.board` …) 안에 있는지로 판정한다.
 *
 * 엔진 산출물(dist/engine)이 없으면 3 · 4 는 건너뛴다. 숫자는 기기마다 다르다 — 목표 검사는 CI 러너
 * (web.yml «성능» 묶음) 기준이고, 개발 기기(Celeron N4500)에서는 `PERF_BUDGET=off` 로 본다.
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { writeFileSync } from "node:fs";
import { DIST, serveDist } from "./serve-dist.ts";
import { hasEngine } from "./isolation.ts";
import { watchBrowser } from "./csp-watch.ts";

const PORT = Number(process.env.SMOKE_PORT ?? 4185);
const BASE = `http://localhost:${PORT}`;
const BUDGET = process.env.PERF_BUDGET !== "off";
const VIEWPORT = { width: 1440, height: 900 };
const ANALYZE_MS = Number(process.env.PERF_ANALYZE_MS ?? 10_000);

/**
 * §6 목표치. 기동은 브라우저 첫 페인트를 셸 «첫 화면»의 대리값으로 본다(웹뷰 프로세스 기동은 셸 실측 — 계획서 §9.10).
 * 리렌더 밖 범위는 0 이어야 한다 — 시간이 아니라 구조라 기기를 타지 않는 회귀 경보다.
 */
const TARGET = {
  firstPaintMs: 1000,
  boardReadyMs: 1000,
  syncP95Ms: 16,
  mainBusyPct: 10,
  rerenderOutside: 0,
  memoryMB: 200,
} as const;

/**
 * 분석 중 다시 그려져도 되는 영역(§6 «분석 중 리렌더 범위 = 캡슐 + 인스펙터»). 판 · 평가 바는 실시간 값을 그리는
 * 것이 일이라 함께 둔다. 콘솔 칸 수(`.inspector__count`)는 인스펙터 안이다.
 */
const ALLOWED = [".capsule", ".inspector", ".board", ".evalbar", '[data-k="engine-indicator"]'];

// ── 페이지에 심는 계측 ──────────────────────────────────────────────

/** 데스크톱 배치 표지 — 셸이 첫 프레임 전에 붙이는 것과 같다(shots.ts 의 desktop 변형). */
async function desktopContext(ctx: BrowserContext): Promise<void> {
  await ctx.route("**/theme-init.js", async (route) => {
    const res = await route.fetch();
    const body = `${await res.text()};document.documentElement.dataset.desktop = "";`;
    await route.fulfill({ response: res, body });
  });
  // tsx(esbuild keepNames)는 안쪽 함수에 `__name(…)` 을 덧대 직렬화된 함수가 페이지에서 그것을 찾는다 — 빈 대역을 먼저 둔다.
  await ctx.addInitScript("globalThis.__name = (f) => f;");
  await ctx.addInitScript(INSTRUMENT);
}

/** 브라우저 안에서 도는 계측(직렬화되어 들어간다 — 바깥 변수를 쓰지 않는다). */
const INSTRUMENT = () => {
  type Fiber = {
    tag: number;
    flags: number;
    child: Fiber | null;
    sibling: Fiber | null;
    type: unknown;
    stateNode: unknown;
    memoizedProps: unknown;
    memoizedState: unknown;
  };
  const w = window as unknown as Record<string, unknown>;
  const seen = new WeakMap<Fiber, [unknown, unknown]>();
  let counting = false;
  let commits = 0;
  const renders: Array<{ el: Element | null; name: string }> = [];
  const FUNCTION_LIKE = new Set([0, 1, 11, 15]); // Function · Class · ForwardRef · SimpleMemo
  const PERFORMED_WORK = 1;
  const hostOf = (f: Fiber): Element | null => {
    let c: Fiber | null = f.child;
    while (c && typeof c.type !== "string") c = c.child;
    return c && c.stateNode instanceof Element ? c.stateNode : null;
  };
  const walk = (root: Fiber) => {
    const stack: Fiber[] = [root];
    while (stack.length) {
      const f = stack.pop()!;
      if (FUNCTION_LIKE.has(f.tag) && f.flags & PERFORMED_WORK) {
        // 일을 하지 않은 하위 트리는 지난 커밋의 섬유를 그대로 달고 있다(표지도 그대로) — 지난번에 센 것과
        // props · state 가 같으면 이번 커밋에 그려진 것이 아니다.
        const prev = seen.get(f);
        if (!prev || prev[0] !== f.memoizedProps || prev[1] !== f.memoizedState) {
          seen.set(f, [f.memoizedProps, f.memoizedState]);
          if (counting) {
            const t = f.type as { displayName?: string; name?: string } | null;
            renders.push({ el: hostOf(f), name: t?.displayName ?? t?.name ?? "?" });
          }
        }
      }
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
  };
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject(this: { renderers: Map<number, unknown> }, r: unknown) {
      const id = this.renderers.size + 1;
      this.renderers.set(id, r);
      return id;
    },
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
    onCommitFiberRoot(_id: number, root: { current: Fiber }) {
      if (counting) commits++;
      walk(root.current);
    },
  };
  w.__perf = {
    start() {
      counting = true;
      commits = 0;
      renders.length = 0;
    },
    stop(allowed: string[]) {
      counting = false;
      const outside = new Map<string, number>();
      const inside = new Map<string, number>();
      for (const r of renders) {
        const el = r.el;
        const sig = el
          ? `${el.tagName.toLowerCase()}${el.classList[0] ? "." + el.classList[0] : ""}`
          : `(DOM 없음 ${r.name})`;
        const ok = el !== null && allowed.some((a) => el.closest(a));
        const m = ok ? inside : outside;
        m.set(sig, (m.get(sig) ?? 0) + 1);
      }
      const top = (m: Map<string, number>) =>
        [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`);
      return {
        commits,
        renders: renders.length,
        outside: [...outside.values()].reduce((a, b) => a + b, 0),
        outsideTop: top(outside).slice(0, 12),
        insideTop: top(inside).slice(0, 8),
      };
    },
  };
  // 판이 처음 그려진 프레임(정적 · 동적 캔버스 둘 다 크기를 얻은 때).
  const poll = () => {
    const cs = document.querySelectorAll<HTMLCanvasElement>(".board canvas");
    if (cs.length >= 2 && [...cs].every((c) => c.width > 0)) w.__boardReadyAt = performance.now();
    else requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
};

/**
 * 손짓 하나 — 합성 키 사건을 보내고 «동기 처리 시간»(사건 처리 · React 동기 커밋 · 판 그리기)과 «다음 프레임까지»를 잰다.
 * 키 사건은 React 가 이산 사건으로 다뤄 같은 틱 안에서 커밋 · 효과까지 끝낸다.
 */
async function gesture(page: Page, target: "window" | "board", key: string) {
  return page.evaluate(
    async ([target, key]) => {
      const el = target === "board" ? document.querySelector(".board[tabindex='0']")! : window;
      const t0 = performance.now();
      el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      // 창 수신기에서 고친 스토어는 React 가 마이크로태스크로 커밋한다 — 실제 입력이면 수신기마다 비워지는 자리.
      await Promise.resolve();
      await Promise.resolve();
      const t1 = performance.now();
      await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      return { sync: t1 - t0, frame: performance.now() - t0 };
    },
    [target, key] as const,
  );
}

const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};
const median = (xs: number[]) => pct(xs, 50);
const r1 = (x: number) => Math.round(x * 10) / 10;

/** 30수 — 천원에서 시작해 두 칸 격자에 흑백을 번갈아(같은 색끼리 붙지 않아 금수 · 오목이 생기지 않는다). */
function reviewGame(): string {
  const cells: Array<{ x: number; y: number; d: number }> = [];
  for (let y = 1; y <= 13; y += 2)
    for (let x = 1; x <= 13; x += 2) cells.push({ x, y, d: Math.hypot(x - 7, y - 7) });
  const byDist = (a: { d: number }, b: { d: number }) => a.d - b.d;
  const color = (c: { x: number; y: number }) => ((c.x - 1) / 2 + (c.y - 1) / 2) % 2;
  const black = cells.filter((c) => color(c) === 0).sort(byDist);
  const white = cells.filter((c) => color(c) === 1).sort(byDist);
  const moves: string[] = [];
  for (let i = 0; i < 15; i++)
    for (const c of [black[i]!, white[i]!])
      moves.push(`${String.fromCharCode(97 + c.x)}${c.y + 1}`);
  return moves.join("");
}

// ── 시나리오 ───────────────────────────────────────────────────────

/** 페이지 집계기(`__perf.stop`)의 답. */
interface Coverage {
  commits: number;
  renders: number;
  outside: number;
  outsideTop: string[];
  insideTop: string[];
}

interface Result {
  startup: {
    firstPaintMs: number;
    boardReadyMs: number;
    jsKB: number;
    cssKB: number;
    runs: number[];
  };
  interaction: {
    stepSyncP95: number;
    stepFrameP95: number;
    placeSyncP95: number;
    placeFrameP95: number;
  };
  analysis?: {
    engineReadyMs: number;
    mainBusyPct: number;
    /** 점유의 내역(%) — 스크립트 · 스타일 · 레이아웃. 나머지는 페인트 · 합성 · 래스터 커밋 등. */
    scriptPct: number;
    stylePct: number;
    layoutPct: number;
    fps: number;
    commits: number;
    renders: number;
    rerenderOutside: number;
    outsideTop: string[];
    insideTop: string[];
    placeSyncP95: number;
  };
  memory?: { pageMB: number | null; jsHeapMB: number };
}

async function startup(ctxOf: () => Promise<BrowserContext>): Promise<Result["startup"]> {
  const fp: number[] = [];
  const ready: number[] = [];
  let jsKB = 0;
  let cssKB = 0;
  for (let i = 0; i < 3; i++) {
    const ctx = await ctxOf();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/board?autoboot=0`, { waitUntil: "load" });
    await page.waitForFunction(
      () =>
        "__boardReadyAt" in window &&
        performance.getEntriesByName("first-contentful-paint").length > 0,
      null,
      { timeout: 30_000 },
    );
    const m = await page.evaluate(() => {
      const paint = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? NaN;
      const at = (window as unknown as { __boardReadyAt: number }).__boardReadyAt;
      const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      const sum = (ext: RegExp) =>
        res
          .filter((r) => ext.test(new URL(r.name).pathname) && r.responseEnd <= at)
          .reduce((a, r) => a + (r.decodedBodySize || r.encodedBodySize), 0);
      return { paint, at, js: sum(/\.js$/), css: sum(/\.css$/) };
    });
    fp.push(m.paint);
    ready.push(m.at);
    jsKB = Math.round(m.js / 1024);
    cssKB = Math.round(m.css / 1024);
    await ctx.close();
  }
  return {
    firstPaintMs: Math.round(median(fp)),
    boardReadyMs: Math.round(median(ready)),
    jsKB,
    cssKB,
    runs: ready.map(Math.round),
  };
}

async function interaction(page: Page): Promise<Result["interaction"]> {
  await page.goto(`${BASE}/board?autoboot=0&p=${reviewGame()}`, { waitUntil: "load" });
  await page.waitForFunction(() => "__boardReadyAt" in window);
  await page.waitForTimeout(500);
  const step = { sync: [] as number[], frame: [] as number[] };
  for (const key of ["ArrowLeft", "ArrowRight"])
    for (let i = 0; i < 30; i++) {
      const g = await gesture(page, "window", key);
      step.sync.push(g.sync);
      step.frame.push(g.frame);
    }
  const label = await page.locator(".board canvas[role=img]").first().getAttribute("aria-label");
  if (!label || !/30/.test(label)) console.warn(`  ! 리뷰 뒤 판이 30수가 아닙니다 (${label})`);

  // 새 판 → 키보드로 10수. 커서를 천원부터 나선으로 옮기며 둔다.
  const place = await placeSeries(page, 10);
  if (process.env.PERF_VERBOSE)
    console.log(
      `   (착수 프레임 ${place.frame.map(Math.round).join(" ")} · 처리 ${place.sync.map(r1).join(" ")})`,
    );
  return {
    stepSyncP95: r1(pct(step.sync, 95)),
    stepFrameP95: r1(pct(step.frame, 95)),
    placeSyncP95: r1(pct(place.sync, 95)),
    placeFrameP95: r1(pct(place.frame, 95)),
  };
}

/** 빈 판으로 가서(새 판) 키보드로 n 수를 둔다. 둘 때마다 커서를 두 칸씩 옮겨 붙은 돌이 생기지 않게. */
async function placeSeries(page: Page, n: number) {
  await page.evaluate(() => {
    // 새 판은 툴바 «새 판»이 확인을 물을 수 있어 처음으로 되감기(Home)로 대신한다 — 돌이 없는 판이면 된다.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
  });
  await page.locator(".board[tabindex='0']").first().focus();
  const out = { sync: [] as number[], frame: [] as number[] };
  const path = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
  for (let i = 0; i < n; i++) {
    const g = await gesture(page, "board", "Enter");
    out.sync.push(g.sync);
    out.frame.push(g.frame);
    for (let k = 0; k < 2 + Math.floor(i / 2); k++) await gesture(page, "board", path[i % 4]!);
  }
  return out;
}

async function analysis(page: Page, cdp: Awaited<ReturnType<BrowserContext["newCDPSession"]>>) {
  const t0 = Date.now();
  await page.goto(`${BASE}/board`, { waitUntil: "load" });
  await page
    .locator('[data-k="engine-indicator"][data-status="ready"]')
    .waitFor({ timeout: 180_000 });
  const engineReadyMs = Date.now() - t0;
  // 판에 몇 수 — 첫 수만 있는 판은 엔진이 즉답할 수 있다.
  await page.goto(`${BASE}/board?p=h8i9j8i7`, { waitUntil: "load" });
  await page
    .locator('[data-k="engine-indicator"][data-status="ready"]')
    .waitFor({ timeout: 180_000 });
  const tab = page.getByRole("tab", { name: "분석", exact: true });
  if (await tab.count()) await tab.first().click();
  await page.getByRole("button", { name: "엔진 분석", exact: true }).first().click();
  await page.locator('.panel__badge[data-status="searching"]').first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1500); // 첫 조각 · 첫 스냅샷이 자리 잡을 때까지

  await cdp.send("Performance.enable");
  const metric = async () => {
    const { metrics } = await cdp.send("Performance.getMetrics");
    const get = (n: string) => metrics.find((m) => m.name === n)?.value ?? 0;
    return {
      task: get("TaskDuration"),
      script: get("ScriptDuration"),
      style: get("RecalcStyleDuration"),
      layout: get("LayoutDuration"),
      at: get("Timestamp"),
    };
  };
  await page.evaluate(() => {
    (window as unknown as { __perf: { start(): void } }).__perf.start();
    const w = window as unknown as { __frames: number; __counting: boolean };
    w.__frames = 0;
    w.__counting = true;
    const tick = () => {
      if (!w.__counting) return;
      w.__frames++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const m0 = await metric();
  await page.waitForTimeout(ANALYZE_MS);
  const m1 = await metric();
  const r = await page.evaluate((allowed) => {
    const w = window as unknown as {
      __frames: number;
      __counting: boolean;
      __perf: { stop(a: string[]): Coverage };
    };
    w.__counting = false;
    return { frames: w.__frames, ...w.__perf.stop(allowed) };
  }, ALLOWED);
  const wall = m1.at - m0.at;

  // 분석 중 착수 — 새 국면으로 탐색이 다시 걸리는 손짓.
  const place = await placeSeries(page, 8);
  if (process.env.PERF_VERBOSE)
    console.log(`   (분석 중 착수 처리 ${place.sync.map(r1).join(" ")})`);
  await page
    .getByRole("button", { name: "엔진 멈춤" })
    .first()
    .click()
    .catch(() => {});

  return {
    engineReadyMs,
    mainBusyPct: r1(((m1.task - m0.task) / wall) * 100),
    scriptPct: r1(((m1.script - m0.script) / wall) * 100),
    stylePct: r1(((m1.style - m0.style) / wall) * 100),
    layoutPct: r1(((m1.layout - m0.layout) / wall) * 100),
    fps: r1(r.frames / wall),
    commits: r.commits,
    renders: r.renders,
    rerenderOutside: r.outside,
    outsideTop: r.outsideTop,
    insideTop: r.insideTop,
    placeSyncP95: r1(pct(place.sync, 95)),
  };
}

async function memory(page: Page, cdp: Awaited<ReturnType<BrowserContext["newCDPSession"]>>) {
  const pageBytes = await page.evaluate(async () => {
    const p = performance as unknown as {
      measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
    };
    if (!crossOriginIsolated || !p.measureUserAgentSpecificMemory) return null;
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 60_000));
    // 헤드리스 셸은 격리돼 있어도 막는 경우가 있다 — 없으면 JS 힙만 본다.
    const m = await Promise.race([p.measureUserAgentSpecificMemory(), timeout]).catch(() => null);
    return m ? m.bytes : null;
  });
  const { metrics } = await cdp.send("Performance.getMetrics");
  const heap = metrics.find((m) => m.name === "JSHeapUsedSize")?.value ?? 0;
  return {
    pageMB: pageBytes === null ? null : Math.round(pageBytes / 2 ** 20),
    jsHeapMB: Math.round(heap / 2 ** 20),
  };
}

// ── 실행 ───────────────────────────────────────────────────────────

const server = await serveDist(PORT);
const browser = watchBrowser(await chromium.launch());
const newCtx = async () => {
  const ctx = await browser.newContext({ viewport: VIEWPORT, locale: "ko-KR" });
  await desktopContext(ctx);
  return ctx;
};
const result: Partial<Result> = {};
try {
  console.log("1. 기동");
  result.startup = await startup(newCtx);
  console.log(
    `   첫 페인트 ${result.startup.firstPaintMs}ms · 판 ${result.startup.boardReadyMs}ms` +
      ` (${result.startup.runs.join(" · ")}) · JS ${result.startup.jsKB}KB · CSS ${result.startup.cssKB}KB`,
  );

  console.log("2. 조작");
  {
    const ctx = await newCtx();
    const page = await ctx.newPage();
    result.interaction = await interaction(page);
    const i = result.interaction;
    console.log(
      `   ← → 30번 p95: 처리 ${i.stepSyncP95}ms · 프레임 ${i.stepFrameP95}ms` +
        ` | 착수 10수 p95: 처리 ${i.placeSyncP95}ms · 프레임 ${i.placeFrameP95}ms (프레임은 참고)`,
    );
    await ctx.close();
  }

  if (hasEngine(DIST)) {
    console.log(`3. 분석 (${ANALYZE_MS / 1000}초)`);
    const ctx = await newCtx();
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    result.analysis = await analysis(page, cdp);
    const a = result.analysis;
    console.log(
      `   엔진 준비 ${a.engineReadyMs}ms · 메인 점유 ${a.mainBusyPct}%(스크립트 ${a.scriptPct} · 스타일 ${a.stylePct} · 레이아웃 ${a.layoutPct}) · ${a.fps}fps · 커밋 ${a.commits} · 렌더 ${a.renders}` +
        ` · 범위 밖 ${a.rerenderOutside} · 분석 중 착수 p95 ${a.placeSyncP95}ms`,
    );
    if (a.outsideTop.length) console.log(`   범위 밖: ${a.outsideTop.join(", ")}`);
    console.log(`   범위 안: ${a.insideTop.join(", ")}`);
    console.log("4. 메모리");
    result.memory = await memory(page, cdp);
    console.log(
      `   페이지 전체 ${result.memory.pageMB ?? "—"}MB · JS 힙 ${result.memory.jsHeapMB}MB`,
    );
    await ctx.close();
  } else {
    console.log("3 · 4 건너뜀 — 엔진 산출물이 없습니다 (dist/engine/).");
  }
} finally {
  await browser.close();
  server.close();
}

if (process.env.PERF_OUT) writeFileSync(process.env.PERF_OUT, JSON.stringify(result, null, 2));

// ── 목표 검사 ─────────────────────────────────────────────────────
const misses: string[] = [];
const check = (name: string, value: number | null | undefined, limit: number, unit: string) => {
  if (value === null || value === undefined || Number.isNaN(value)) return;
  if (value > limit) misses.push(`${name} ${value}${unit} > ${limit}${unit}`);
};
const s = result.startup!;
const i = result.interaction!;
check("첫 페인트", s.firstPaintMs, TARGET.firstPaintMs, "ms");
check("판 그림", s.boardReadyMs, TARGET.boardReadyMs, "ms");
check("리뷰 넘기기 처리 p95", i.stepSyncP95, TARGET.syncP95Ms, "ms");
check("착수 처리 p95", i.placeSyncP95, TARGET.syncP95Ms, "ms");
if (result.analysis) {
  check("분석 중 메인 점유", result.analysis.mainBusyPct, TARGET.mainBusyPct, "%");
  check("분석 중 범위 밖 리렌더", result.analysis.rerenderOutside, TARGET.rerenderOutside, "회");
  check("분석 중 착수 처리 p95", result.analysis.placeSyncP95, TARGET.syncP95Ms, "ms");
}
check("페이지 메모리", result.memory?.pageMB, TARGET.memoryMB, "MB");

if (misses.length === 0) console.log("\n목표 안 ✓");
else {
  console.log(
    `\n목표 밖 ${misses.length}건${BUDGET ? "" : " (PERF_BUDGET=off — 실패로 치지 않음)"}:`,
  );
  for (const m of misses) console.log(`  ✗ ${m}`);
  if (BUDGET) process.exitCode = 1;
}
