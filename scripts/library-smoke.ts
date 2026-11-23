/**
 * 라이브러리 L3 스모크 — 병합 · 분리를 진짜 브라우저의 워커 · IndexedDB 로 돈다(엔진 없음).
 *
 *   pnpm build && pnpm exec tsx scripts/library-smoke.ts
 *
 *  1. 합성 yixindb(주형 다섯 줄기 · 부모 없는 국면)를 가져오면 워커가 센 국면 수가 카드에 뜬다.
 *  2. 상세 [나누기] ▸ 주형별(주형마다 한 파일, 복사) — 결과 카드의 국면 수가 node 에서 센 것과 같고 원본은 그대로.
 *  3. 결과 둘을 골라(체크 원) [합치기] ▸ 미리 보기의 합계 = 둘의 합 ▸ 새 항목의 국면 수도 같다.
 *  4. 합친 DB 를 [나누기] ▸ 풀린 국면만 · 옮기기 ▸ 확인 — 원본에는 나머지만, 휴지통에 «(나누기 전)» 사본.
 *  5. 페이지 오류 · CSP 위반이 없다.
 *
 * 합성 자료는 RenjuNet 기보가 아니다(라이선스) — 대표 수 + 결정적인 무작위 수.
 */
import { chromium, type Page } from "playwright";
import { compareYxdbKeys, metaRecord, YxdbWriter } from "../src/core/database/yxdbfile.ts";
import { keyOfMoves, keyToHex } from "../src/core/database/yxdbkey.ts";
import { countSplit } from "../src/core/database/yxdbsplit.ts";
import { NONSTD, representative } from "../src/core/opening/opening26.ts";
import { move, type Move } from "../src/core/model/move.ts";
import { watchBrowser } from "./csp-watch.ts";
import { serveDist } from "./serve-dist.ts";

const PORT = Number(process.env.SMOKE_PORT ?? 4186);
const BASE = `http://localhost:${PORT}`;
let failures = 0;
const fail = (m: string) => {
  console.error(`라이브러리 스모크 실패: ${m}`);
  failures++;
};
const ok = (m: string) => console.log(`  ✓ ${m}`);

// ── 합성 DB ──
function synth(): Uint8Array {
  let s = 11;
  const rnd = (n: number) => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff), s % n);
  const map = new Map<string, { key: Uint8Array; value: Uint8Array }>();
  const add = (line: readonly Move[]) => {
    for (let i = 0; i <= line.length; i++) {
      const key = keyOfMoves(2, 15, line.slice(0, i));
      const h = keyToHex(key);
      if (map.has(h)) continue;
      const r = rnd(4);
      map.set(h, {
        key,
        value:
          r === 0 ? new Uint8Array(0) : new Uint8Array([0x77 + (r === 1 ? 0 : -11), 0, 0, 12, 0]),
      });
    }
  };
  for (const op of [0, 3, 4, 13, 17])
    for (let k = 0; k < 6; k++) {
      const line = [...representative(op)];
      const used = new Set(line.map((m) => m.x * 32 + m.y));
      while (line.length < 11) {
        const m = move(3 + rnd(9), 3 + rnd(9));
        if (used.has(m.x * 32 + m.y)) continue;
        used.add(m.x * 32 + m.y);
        line.push(m);
      }
      add(line);
    }
  add([move(1, 1), move(2, 2), move(3, 1), move(13, 13)]);
  const recs = [...map.values()].sort((a, b) =>
    compareYxdbKeys(a.key, 0, a.key.length, b.key, 0, b.key.length),
  );
  const m = metaRecord();
  const out: Uint8Array[] = [];
  const w = new YxdbWriter(recs.length + 1, (c) => out.push(c), { blockKB: 64 });
  w.recordKV(m.key, 0, m.key.length, m.value, 0, m.value.length);
  for (const r of recs) w.recordKV(r.key, 0, r.key.length, r.value, 0, r.value.length);
  w.finish();
  const bytes = new Uint8Array(out.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of out) {
    bytes.set(c, p);
    p += c.length;
  }
  return bytes;
}

const bytes = synth();
const counts = await countSplit(new Blob([bytes as BlobPart]), null);
const openings = counts
  .openings!.map((n, i) => ({ i, n }))
  .filter((x) => x.n > 0 && x.i !== NONSTD);

/** 카드의 부제에서 국면 수 — «1,234 국면 · 렌주 15». */
async function positionsOf(page: Page, title: string): Promise<number | null> {
  const sub = page
    .locator(".libgrid__item", {
      has: page.locator(".libgrid__title", {
        hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
      }),
    })
    .locator(".libgrid__sub");
  try {
    await sub.filter({ hasText: "국면" }).waitFor({ timeout: 20_000 });
  } catch {
    return null;
  }
  const m = /([\d,]+)\s*국면/.exec((await sub.textContent()) ?? "");
  return m ? Number(m[1]!.replace(/,/g, "")) : null;
}

const server = await serveDist(PORT);
const browser = watchBrowser(await chromium.launch());
try {
  const ctx = await browser.newContext({ locale: "ko-KR", viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem("rapfi.dataPrompt.sheet", "1"));
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/library?autoboot=0`, { waitUntil: "networkidle" });

  console.log("1. 가져오기");
  await page.locator("input[type=file]").setInputFiles({
    name: "합성.db",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(bytes),
  });
  const n0 = await positionsOf(page, "합성");
  if (n0 === counts.total) ok(`워커가 센 국면 ${n0}`);
  else fail(`가져온 DB 의 국면 수 ${n0} ≠ ${counts.total}`);

  console.log("2. 나누기 — 주형별 · 복사");
  await page.locator(".libgrid__item", { hasText: "합성" }).locator(".libgrid__card").click();
  await page.locator('[data-k="library-split"]').click();
  const sheet = page.locator('[data-k="split-sheet"]');
  await sheet.locator(".libchoice").first().waitFor({ timeout: 20_000 });
  await sheet.locator('[data-k="split-next"]').click();
  await sheet.locator('[data-k="split-next"]').click();
  const rows = await sheet.locator(".libsplit__row").count();
  if (rows === openings.length) ok(`미리 보기 결과 ${rows}개`);
  else fail(`미리 보기 결과 ${rows} ≠ ${openings.length}`);
  await sheet.locator('[data-k="split-commit"]').click();
  await page
    .locator('[data-k="split-sheet"]:not([open])')
    .waitFor({ state: "attached", timeout: 20_000 });
  await page.goto(`${BASE}/library?autoboot=0`, { waitUntil: "networkidle" });
  const names: string[] = [];
  for (const o of openings) {
    const { nameOf } = await import("../src/core/opening/opening26.ts");
    const title = `합성 · ${nameOf(o.i)}`;
    names.push(title);
    const n = await positionsOf(page, title);
    if (n !== o.n) fail(`${title} 국면 ${n} ≠ ${o.n}`);
  }
  ok(`주형별 결과의 국면 수가 node 계산과 같다(${openings.map((o) => o.n).join(" · ")})`);
  if ((await positionsOf(page, "합성")) !== counts.total) fail("복사로 나눴는데 원본이 바뀌었다");

  console.log("3. 합치기");
  const pick = names.slice(0, 2);
  for (const t of pick)
    await page
      .locator(".libgrid__item", { has: page.locator(".libgrid__title", { hasText: t }) })
      .locator(".libgrid__check")
      .click();
  await page.locator('[data-k="library-merge"]').click();
  const ms = page.locator('[data-k="merge-sheet"]');
  await ms.locator(".cta").click();
  await ms.locator('[data-k="merge-preview"]').click();
  await ms.locator('[data-k="merge-summary"]').waitFor({ timeout: 20_000 });
  const want = openings[0]!.n + openings[1]!.n;
  const total = Number(
    ((await ms.locator(".libsum dd").first().textContent()) ?? "").replace(/[^\d]/g, ""),
  );
  if (total === want) ok(`미리 보기 합계 ${total}`);
  else fail(`미리 보기 합계 ${total} ≠ ${want}`);
  await ms.locator('[data-k="merge-commit"]').click();
  await page.waitForURL(/\/library\/[0-9a-f-]{20,}/, { timeout: 20_000 });
  await page.goto(`${BASE}/library?autoboot=0`, { waitUntil: "networkidle" });
  const merged = `${pick[0]} + ${pick[1]}`;
  const nm = await positionsOf(page, merged);
  if (nm === want) ok(`합친 DB 국면 ${nm}`);
  else fail(`합친 DB 국면 ${nm} ≠ ${want}`);

  console.log("4. 나누기 — 풀린 국면만 · 옮기기");
  await page
    .locator(".libgrid__item", { has: page.locator(".libgrid__title", { hasText: merged }) })
    .locator(".libgrid__card")
    .click();
  await page.locator('[data-k="library-split"]').click();
  await sheet.locator(".libchoice").first().waitFor({ timeout: 20_000 });
  await sheet.locator(".libchoice", { hasText: "풀린 국면만" }).locator(".libchoice__head").click();
  await sheet.locator('[data-k="split-next"]').click();
  await sheet.locator(".libchoice", { hasText: "옮기기" }).locator(".libchoice__head").click();
  await sheet.locator('[data-k="split-next"]').click();
  const check = (await sheet.locator('[data-k="split-check"]').textContent()) ?? "";
  const nums = (check.match(/[\d,]+/g) ?? []).map((x) => Number(x.replace(/,/g, "")));
  if (nums.length === 3 && nums[0]! + nums[1]! === nums[2] && nums[2] === want)
    ok(`검산 «${check}»`);
  else fail(`검산 줄이 맞지 않는다: ${check}`);
  await sheet.locator('[data-k="split-commit"]').click();
  await sheet.locator(".libconfirm .btn--danger").click();
  await page
    .locator('[data-k="split-sheet"]:not([open])')
    .waitFor({ state: "attached", timeout: 20_000 });
  await page.goto(`${BASE}/library?autoboot=0`, { waitUntil: "networkidle" });
  const rest = await positionsOf(page, merged);
  if (rest === nums[1]) ok(`원본에는 나머지 ${rest}`);
  else fail(`옮긴 뒤 원본 ${rest} ≠ ${nums[1]}`);
  const trash = (await page.locator(".libtrash__title").allTextContents()).join(" | ");
  if (trash.includes("(나누기 전)")) ok("휴지통에 원본 사본");
  else fail(`휴지통에 사본이 없다: ${trash}`);

  if (errors.length) fail(`페이지 오류: ${errors.join(" / ")}`);
  await ctx.close();
} catch (e) {
  fail(String(e));
} finally {
  await browser.close();
  server.close();
}
if (failures) {
  console.error(`라이브러리 스모크: 실패 ${failures}건`);
  process.exit(1);
}
console.log("라이브러리 스모크 통과");
