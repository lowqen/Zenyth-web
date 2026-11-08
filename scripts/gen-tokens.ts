/**
 * 토큰 생성기 — `src/styles/tokens.css` 를 굽는다.
 *
 *   pnpm gen:tokens            생성(덮어쓰기)
 *   tsx scripts/gen-tokens.ts --check   생성물이 최신인지만 확인(CI·빌드)
 *
 * 생성물은 **커밋하지 않는다**(`.gitignore`). 계획서 §5 초안은 커밋을 상정했지만,
 * 커밋해 두면 «램프를 고치고 CSS 를 잊는» 어긋남이 생길 수 있어 `dev`·`build`
 * ·`typecheck` 가 매번 굽는 쪽으로 바꿨다 — 원본이 하나뿐이면 어긋날 자리가 없다.
 * 앱과 값이 같은지는 CSS 가 아니라 `ramps.test.ts` 의 골든 앵커가 지킨다.
 *
 * **왜 빌드 타임인가.** 앱의 팔레트는 `TonalRamp.tone(n)` 에서 파생되고,
 * `Oklch.kt` 는 톤(CIE L*)을 Oklab L 로 정확 변환한 뒤 sRGB 감마맵을 **채도
 * 이분탐색**으로 한다. CSS 의 `oklch()` 도 원리는 같지만 구현 차이를 런타임에
 * 떠안을 이유가 없다. 여기서 굽고 나면 (1) 브라우저별 차이가 배제되고,
 * (2) 구형 폴백이 필요 없는 hex 가 나오고, (3) **앱과 같은 값임을 시험으로
 * 고정**할 수 있다.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toHex, type Rgb } from "../src/core/design/oklch.ts";
import {
  LightScheme,
  DarkScheme,
  AmoledScheme,
  AMOLED_KEYS,
  WoodLight,
  WoodDark,
  type Scheme,
  type TokenValue,
} from "../src/core/design/scheme.ts";
import {
  FONT_STACKS,
  TYPE,
  MONO,
  SPACE,
  RADIUS,
  MOTION,
  LAYOUT,
  RHYTHM,
  DESKTOP,
  RHYTHM_DESKTOP,
  CHROME_ALPHA,
} from "../src/core/design/tokens.ts";

import { SPRINGS, SPRING_FALLBACK, springEasing } from "../src/core/design/springs.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../src/styles/tokens.css");

const isBlack = (v: TokenValue): v is { black: number } => "black" in v;

function value(v: TokenValue): string {
  if (isBlack(v)) {
    const a = Math.round(v.black * 1000) / 1000;
    return a >= 1 ? "#000000" : `rgb(0 0 0 / ${a})`;
  }
  return toHex(v as Rgb);
}

/** 스킴 하나를 CSS 변수로. `keys` 를 주면 그 토큰만(AMOLED 덧씌움 블록). */
function colorBlock(s: Scheme, indent: string, keys: readonly string[] = Object.keys(s)): string {
  return keys.map((k) => `${indent}--c-${k}: ${value(s[k]!)};`).join("\n");
}

const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

/** 스프링의 진짜 곡선 — `linear()` 를 아는 브라우저만. */
function springBlock(): string {
  return (Object.keys(SPRINGS) as (keyof typeof SPRINGS)[])
    .map((k) => `    --spring-${kebab(k)}: ${springEasing(SPRINGS[k]).easing};`)
    .join("\n");
}

function typeBlock(): string {
  const lines = [`  --font-sans: ${FONT_STACKS.sans};`, `  --font-mono: ${FONT_STACKS.mono};`];
  for (const [name, s] of Object.entries(TYPE)) {
    lines.push(`  --type-${name}: ${s.weight} ${s.size}px/${s.line}px var(--font-sans);`);
    lines.push(`  --track-${name}: ${s.tracking ?? 0}px;`);
  }
  lines.push(`  --type-mono: 400 ${MONO.size}px/${MONO.line}px var(--font-mono);`);
  for (const [k, v] of Object.entries(SPACE)) lines.push(`  --space-${k}: ${v}px;`);
  for (const [k, v] of Object.entries(RADIUS)) lines.push(`  --radius-${k}: ${v}px;`);
  for (const [k, v] of Object.entries(MOTION)) lines.push(`  --motion-${k}: ${v}ms;`);
  // 크롬 스프링(Z9): 멈출 때까지의 시간과, `linear()` 를 모르는 브라우저를 위한 3차 곡선. 진짜 곡선은 아래
  // @supports 블록이 덮는다.
  for (const k of Object.keys(SPRINGS) as (keyof typeof SPRINGS)[]) {
    const name = kebab(k);
    lines.push(`  --spring-${name}: ${SPRING_FALLBACK[k]};`);
    lines.push(`  --spring-${name}-ms: ${springEasing(SPRINGS[k]).ms}ms;`);
  }
  // camelCase → kebab-case: screenPadding → --screen-padding
  for (const [k, v] of Object.entries(RHYTHM)) lines.push(`  --${kebab(k)}: ${v}px;`);
  lines.push(`  --reading-width: ${LAYOUT.readingWidth}px;`);
  lines.push(`  --wide-min: ${LAYOUT.wideMin}px;`);
  // 데스크톱 셸의 창 크롬 치수. 브레이크포인트(inspectorBeside)는 @media 에 못 들어가므로 내보내지 않는다.
  lines.push(`  --titlebar-height: ${DESKTOP.titleBar}px;`);
  lines.push(`  --caption-button-width: ${DESKTOP.captionButtonWidth}px;`);
  lines.push(`  --rail-expanded: ${DESKTOP.railExpanded}px;`);
  lines.push(`  --inspector-min: ${DESKTOP.inspectorMin}px;`);
  lines.push(`  --inspector-max: ${DESKTOP.inspectorMax}px;`);
  lines.push(`  --capsule-height: ${DESKTOP.capsuleHeight}px;`);
  return lines.join("\n");
}

/** 데스크톱 셸이 `data-desktop` 을 붙였을 때만: 밀도 덮어쓰기와 Mica 위 크롬 색. */
function desktopBlock(): string {
  const lines = Object.entries(RHYTHM_DESKTOP).map(([k, v]) => `  --${kebab(k)}: ${v}px;`);
  // 페이지 색을 따라가므로(라이트 · 다크 · 검은 배경) 스킴마다 따로 굽지 않는다. 합성은 브라우저와 같은 sRGB.
  const pct = Math.round(CHROME_ALPHA * 100);
  lines.push(`  --c-chrome: color-mix(in srgb, var(--c-background) ${pct}%, transparent);`);
  return lines.join("\n");
}

const css = `/* 생성물입니다 — 손으로 고치지 마세요.
 * 원본: src/core/design/{ramps,scheme,tokens}.ts
 * 다시 굽기: pnpm gen:tokens   (CI 는 --check 로 최신 여부를 강제합니다)
 */

:root {
  color-scheme: light;

${colorBlock(LightScheme, "  ")}

${typeBlock()}
}

/* 데스크톱 셸(zenyth-desktop)이 붙이는 data-desktop — 마우스 밀도와 Mica 위 크롬. 웹에서는 켜지지 않는다.
 * --c-chrome 은 :root 에서 계산되어 상속된다(보드의 [data-wood] 가 페이지 색을 바꿔도 크롬은 그대로). */
:root[data-desktop] {
${desktopBlock()}
}

/* 크롬 스프링(Z9 — springs.ts, 앱 ChromeMotion). 판에는 쓰지 않는다. */
@supports (transition-timing-function: linear(0, 1)) {
  :root {
${springBlock()}
  }
}

/* 시스템 설정이 다크이고, 사용자가 라이트를 **명시**하지 않았을 때.
 * settings.txt 27행을 불러오면 data-theme 이 붙어 이 블록을 이긴다. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;

${colorBlock(DarkScheme, "    ")}
  }
}

/* 명시 선택. 3상태(system / light / dark) 중 뒤의 둘만 여기 온다. */
:root[data-theme="dark"] {
  color-scheme: dark;

${colorBlock(DarkScheme, "  ")}
}

:root[data-theme="light"] {
  color-scheme: light;

${colorBlock(LightScheme, "  ")}
}

/* 검은 배경(AMOLED) — 다크일 때만 덧씌운다(scheme.ts AmoledScheme, 앱 Theme.kt amoled()).
 * data-amoled 는 theme-init.js 가 첫 프레임 전에 붙인다. 라이트에서는 아무것도 바꾸지 않는다. */
@media (prefers-color-scheme: dark) {
  :root[data-amoled]:not([data-theme="light"]) {
${colorBlock(AmoledScheme, "    ", AMOLED_KEYS)}
  }
}

:root[data-theme="dark"][data-amoled] {
${colorBlock(AmoledScheme, "  ", AMOLED_KEYS)}
}

/* 보드 화면의 나무색 팔레트(scheme.ts woodScheme, 앱 WoodTheme) — data-wood 를 단 칸(셸이 보드에서 붙인다)
 * 안에서만. 판 스킨 · 값 색은 바꾸지 않는다. 검은 배경에서는 면은 검정 그대로, 강조만 나무. */
[data-wood] {
${colorBlock(WoodLight, "  ")}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) [data-wood] {
${colorBlock(WoodDark, "    ")}
  }
  :root[data-amoled]:not([data-theme="light"]) [data-wood] {
${colorBlock(AmoledScheme, "    ", AMOLED_KEYS)}
  }
}

:root[data-theme="dark"] [data-wood] {
${colorBlock(WoodDark, "  ")}
}

:root[data-theme="dark"][data-amoled] [data-wood] {
${colorBlock(AmoledScheme, "  ", AMOLED_KEYS)}
}
`;

mkdirSync(dirname(OUT), { recursive: true });

if (process.argv.includes("--check")) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (current !== css) {
    console.error(
      "tokens.css 가 원본과 어긋납니다. `pnpm gen:tokens` 를 돌리고 결과를 커밋하세요.\n" +
        "(램프를 고치고 CSS 를 잊는 사고를 막는 게이트입니다.)",
    );
    process.exit(1);
  }
  console.log("tokens.css 최신 상태입니다.");
} else {
  writeFileSync(OUT, css, "utf8");
  const n = Object.keys(LightScheme).length;
  console.log(`tokens.css 생성 — 색 토큰 ${n}개 × 2스킴, 타이포 ${Object.keys(TYPE).length}슬롯`);
}
