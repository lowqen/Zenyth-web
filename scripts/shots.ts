/**
 * 스크린샷 골든 — 빌드된 `dist/` 의 화면을 찍어 `shots/golden/` 과 픽셀로 대조한다.
 *
 *   pnpm build && pnpm exec tsx scripts/shots.ts            # verify(기본)
 *   pnpm exec tsx scripts/shots.ts record                   # shots/actual/ 에 쓰기만
 *   SHOTS_ONLY=board,settings pnpm exec tsx scripts/shots.ts # 일부 장면만
 *
 * 앱의 P0(Roborazzi 골든)과 같은 역할이다(docs/앱-디자인-정렬-계획.md Z0). 디자인을 단계마다 바꾸는
 * 동안 «이 단계가 바꾼 화면은 이것뿐»을 그림으로 보인다. 그래서 골든은 바꾸기 **전** 코드에서 기록한다.
 *
 * **골든은 CI 러너에서만 유효하다.** 글자 래스터는 OS · 글꼴 설치 · GPU 에 따라 다르다. 로컬 실행은
 * 장면이 뜨는지 보는 용도이고, 골든은 `screenshots.yml` 을 `mode=record` 로 돌린 아티팩트를 받아
 * 커밋한다.
 *
 * 흔들리지 않게: 엔진은 띄우지 않고(`?autoboot=0`), 커리큘럼은 고정 자료, 글꼴 로드를 기다리고,
 * 애니메이션 · 전환 · 캐럿을 끄고, 언어 · 시간대 · 배율을 고정한다. 장면마다 새 브라우저 문맥이라
 * IndexedDB · localStorage 는 늘 처음 온 사람의 것이다.
 */
import { chromium, type Browser } from "playwright";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { CURRICULUM_FIXTURE, serveDist } from "./serve-dist.ts";

const PORT = Number(process.env.SMOKE_PORT ?? 4183);
const MODE = process.argv[2] === "record" ? "record" : "verify";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../shots");
const GOLDEN = join(ROOT, "golden");
const ACTUAL = join(ROOT, "actual");
const DIFF = join(ROOT, "diff");

/** 화면 아홉 — 라우트 표(`src/app/routes.tsx`)의 실물 화면 전부(관리자 스튜디오는 뺀다). */
const SCENES: ReadonlyArray<{ name: string; path: string }> = [
  { name: "board", path: "/board" },
  { name: "review", path: "/research/review" },
  { name: "explorer", path: "/research/explorer" },
  { name: "sequence", path: "/research/sequence" },
  { name: "ranking", path: "/research/ranking" },
  { name: "joseki", path: "/joseki" },
  { name: "database", path: "/database" },
  { name: "engine", path: "/engine" },
  { name: "settings", path: "/settings" },
];

interface Variant {
  theme: "light" | "dark";
  width: "wide" | "narrow";
  viewport: { width: number; height: number };
  /** 검은 배경(AMOLED, 설정 «검은 배경») — 다크 위의 덧씌움. 이름 끝이 `-amoled`. */
  amoled?: boolean;
  /** 이 장면들만 찍는다(덧씌움 변형은 모든 화면을 다시 찍을 만큼 다르지 않다). */
  scenes?: readonly string[];
}

/** 넓은 폭(레일 · 2단)과 좁은 폭(하단 탭, 640 미만) × 라이트/다크, 그리고 검은 배경 두 장. */
const VARIANTS: readonly Variant[] = [
  { theme: "light", width: "wide", viewport: { width: 1280, height: 800 } },
  { theme: "dark", width: "wide", viewport: { width: 1280, height: 800 } },
  { theme: "light", width: "narrow", viewport: { width: 390, height: 844 } },
  { theme: "dark", width: "narrow", viewport: { width: 390, height: 844 } },
  {
    theme: "dark",
    width: "wide",
    viewport: { width: 1280, height: 800 },
    amoled: true,
    scenes: ["board", "settings"],
  },
];

const only = (process.env.SHOTS_ONLY ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const scenes = only.length ? SCENES.filter((s) => only.includes(s.name)) : SCENES;

const shotName = (scene: string, v: Variant) =>
  `${scene}-${v.width}-${v.amoled ? "amoled" : v.theme}.png`;

async function shootVariant(browser: Browser, v: Variant) {
  const out: Array<{ name: string; png: Buffer; errors: string[] }> = [];
  for (const scene of scenes.filter((s) => !v.scenes || v.scenes.includes(s.name))) {
    const context = await browser.newContext({
      viewport: v.viewport,
      deviceScaleFactor: 1,
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      colorScheme: v.theme,
      reducedMotion: "reduce",
    });
    // 저장된 선택은 첫 프레임 전에 읽힌다(theme-init.js) — 그보다 먼저 심는다.
    if (v.amoled) await context.addInitScript(() => localStorage.setItem("rapfi.amoled", "1"));
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`http://localhost:${PORT}${scene.path}?autoboot=0`, {
      waitUntil: "networkidle",
    });
    await page.waitForURL(`**${scene.path}`, { timeout: 5_000 }).catch(() => undefined);
    await page.evaluate(async () => {
      await document.fonts.ready;
      // 세그먼트의 선택 알약이 자리를 잡을 때까지(useSlidingPill — 한 프레임 뒤 data-pill="ready").
      // 잡기 전에는 칸이 자기 배경으로, 잡은 뒤에는 ::before 가 같은 모양을 그리는데 둥근 모서리의
      // 계단 픽셀이 조금 달라 장면이 흔들렸다(Z3 board-wide-amoled, 채널 최대 6).
      for (let i = 0; i < 60; i++) {
        const pending = document.querySelectorAll('.pilltrack:not([data-pill="ready"])');
        const unplaced = Array.from(pending).some((el) =>
          el.querySelector(
            ':scope > [aria-selected="true"], :scope > [aria-checked="true"], :scope > [aria-current="page"]',
          ),
        );
        if (!unplaced) break;
        await new Promise((r) => requestAnimationFrame(r));
      }
      // 두 프레임 — 글꼴이 들어온 뒤의 배치가 칠해질 때까지.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    const png = await page.screenshot({ animations: "disabled", caret: "hide", fullPage: false });
    out.push({ name: shotName(scene.name, v), png, errors });
    await context.close();
  }
  return out;
}

/**
 * 채널 하나라도 이만큼 움직인 픽셀만 «다르다».
 *
 * 같은 러너 · 같은 Chromium 이어도 둥근 모서리와 글자 가장자리의 계단 픽셀이 실행마다 채널당 ±1 흔들린다
 * (Z0 에서 같은 커밋을 두 번 찍어 확인 — 설정 검색 칸의 오른쪽 모서리, 수순 카드 모서리). 반대로 지켜야
 * 할 색의 변화는 그보다 훨씬 크다(판 나무 금색 → 메이플은 파랑 채널이 20 움직인다). pixelmatch 의
 * threshold 는 이 둘을 가르지 못했다 — 0.1 은 메이플 판을 «같다», 0 은 ±1 을 «다르다» 고 했다.
 */
const CHANNEL_TOLERANCE = 2;

function changedAt(a: PNG, b: PNG, i: number): boolean {
  return (
    Math.abs(a.data[i]! - b.data[i]!) > CHANNEL_TOLERANCE ||
    Math.abs(a.data[i + 1]! - b.data[i + 1]!) > CHANNEL_TOLERANCE ||
    Math.abs(a.data[i + 2]! - b.data[i + 2]!) > CHANNEL_TOLERANCE
  );
}

function countChanged(a: PNG, b: PNG): number {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) if (changedAt(a, b, i)) n++;
  return n;
}

/** 다른 픽셀은 빨강, 나머지는 골든을 흐리게 — 무엇이 바뀌었는지 한눈에. */
function diffImage(a: PNG, b: PNG): PNG {
  const out = new PNG({ width: a.width, height: a.height });
  for (let i = 0; i < a.data.length; i += 4) {
    if (changedAt(a, b, i)) {
      out.data.set([255, 0, 0, 255], i);
    } else {
      const y = 0.299 * a.data[i]! + 0.587 * a.data[i + 1]! + 0.114 * a.data[i + 2]!;
      const v = Math.round(255 - (255 - y) * 0.15);
      out.data.set([v, v, v, 255], i);
    }
  }
  return out;
}

function compare(name: string, actual: Buffer): string | null {
  const goldenPath = join(GOLDEN, name);
  if (!existsSync(goldenPath)) return "골든 없음";
  const want = PNG.sync.read(readFileSync(goldenPath));
  const got = PNG.sync.read(actual);
  if (want.width !== got.width || want.height !== got.height)
    return `크기가 다름 ${got.width}×${got.height} ≠ ${want.width}×${want.height}`;
  const n = countChanged(want, got);
  if (n === 0) return null;
  writeFileSync(join(DIFF, name), PNG.sync.write(diffImage(want, got)));
  return `${n}픽셀 다름`;
}

rmSync(ACTUAL, { recursive: true, force: true });
rmSync(DIFF, { recursive: true, force: true });
mkdirSync(ACTUAL, { recursive: true });
mkdirSync(DIFF, { recursive: true });

const server = await serveDist(PORT, CURRICULUM_FIXTURE);
const browser = await chromium.launch();
let failed = 0;
try {
  const shots = (await Promise.all(VARIANTS.map((v) => shootVariant(browser, v)))).flat();
  for (const s of shots) {
    if (s.errors.length) {
      failed++;
      console.error(`✗ ${s.name}: 페이지 오류 ${s.errors.join(" | ")}`);
    }
    if (MODE === "record") {
      writeFileSync(join(ACTUAL, s.name), s.png);
      console.log(`● ${s.name}`);
      continue;
    }
    const why = compare(s.name, s.png);
    if (why) {
      failed++;
      writeFileSync(join(ACTUAL, s.name), s.png);
      console.error(`✗ ${s.name}: ${why}`);
    } else {
      console.log(`✓ ${s.name}`);
    }
  }
  console.log(
    MODE === "record"
      ? `기록 ${shots.length}장 → shots/actual/ (골든으로 쓰려면 CI 아티팩트를 shots/golden/ 에 커밋)`
      : `대조 ${shots.length}장 · 다름 ${failed}장`,
  );
} finally {
  await browser.close();
  server.close();
}
if (failed) process.exitCode = 1;
