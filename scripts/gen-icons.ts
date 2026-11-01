/**
 * 파비콘 · PWA 아이콘(Z8) — 앱 런처 아이콘의 «일식»을 `public/` 에 굽는다.
 *
 *   pnpm exec tsx scripts/gen-icons.ts
 *
 * 그림은 앱과 같다(Zenyth `ic_launcher_foreground.xml` · `docs/readme/logo/zenyth-icon.svg`): 메이플 바탕에
 * 진주 초승달과 먹 돌. 두 가지로 굽는다.
 *   - `favicon.svg` · `icon-192.png` · `icon-512.png` — 둥근 타일(앱 README 의 아이콘과 같은 72 단위, 모서리 17)
 *   - `icon-maskable-512.png` · `apple-touch-icon.png` — 꽉 찬 메이플(가장자리는 런처 · iOS 가 깎는다). 그림은
 *     적응형 아이콘의 108 단위 그대로라 안전 원(지름 66) 안에 든다
 * PNG 는 Chromium 으로 그린다 — 따로 그림 도구를 들이지 않는다. 결과는 커밋한다(빌드 때 만들지 않는다).
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../public");
const MAPLE = "#DDB27C";
const STONES = `<path fill="#F6F1E9" d="M56.42,38.15 A16.56,16.56 0 1,1 56.42,69.85 A18.18,18.18 0 0,0 56.42,38.15 z"/><path fill="#171513" d="M32.58,54 a14.94,14.94 0 1,0 29.88,0 a14.94,14.94 0 1,0 -29.88,0 z"/>`;

/** 둥근 타일 — 72 단위(108 그림에서 가운데 72 를 잘라 보인다). */
const TILE = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72"><rect width="72" height="72" rx="17" fill="${MAPLE}"/><g transform="translate(-18 -18)">${STONES}</g></svg>`;
/** 꽉 찬 바탕 — 108 단위 전체(적응형 아이콘과 같다). */
const BLEED = `<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="0 0 108 108"><rect width="108" height="108" fill="${MAPLE}"/>${STONES}</svg>`;

writeFileSync(join(OUT, "favicon.svg"), TILE + "\n");

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function png(svg: string, size: number, file: string, transparent: boolean) {
  await page.setViewportSize({ width: size, height: size });
  const scaled = svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${scaled}</body></html>`,
  );
  writeFileSync(join(OUT, file), await page.screenshot({ omitBackground: transparent }));
  console.log(`  ${file} ${size}px`);
}
await png(TILE, 192, "icon-192.png", true);
await png(TILE, 512, "icon-512.png", true);
await png(BLEED, 512, "icon-maskable-512.png", false);
await png(BLEED, 180, "apple-touch-icon.png", false);
await browser.close();
console.log("아이콘을 public/ 에 썼습니다");
