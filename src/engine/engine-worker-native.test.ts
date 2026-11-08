import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { FromWorker, ToWorker } from "./engine-types";

/**
 * 데스크톱 Z3 완료 조건 — **Z0 골든 녹취를 네이티브 경로로 재생해도 응답 해석과 화면 값이 같다.**
 *
 * 같은 워커 모듈을 두 번 띄워 비교한다.
 *   - WASM 멀티 경로(지금까지의 기준): 글루가 줄 하나씩, UTF-8 바이트를 글자 하나씩 넘긴다(`onReceiveStdout`).
 *   - 네이티브 경로: 셸이 16ms 프레임으로 묶은 줄을 `wireIn` 으로 넘긴다 — 여기서는 묶음 크기를 무작위로 흔든다.
 * 두 경로가 내는 콘솔 줄 · DB 줄 · 금수 · 마지막 스냅샷이 같아야 하고, 콘솔 줄은 녹취의 원문과 같아야 한다
 * (한글이 깨지지 않는다). 녹취는 Yixin(C/GTK)이 실제 엔진(0.43.01)과 주고받은 줄이다(`desktop/baseline/golden`).
 */

type Handler = (ev: { data: ToWorker }) => void;
const g = globalThis as unknown as Record<string, unknown>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, timeoutMs = 5000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error("기다리다 시간이 다 됐습니다");
    await sleep(5);
  }
}

const GOLDEN = join(__dirname, "../../desktop/baseline/golden");
const goldenFiles = readdirSync(GOLDEN).filter((f) => f.endsWith(".jsonl"));

function engineLines(file: string): string[] {
  return readFileSync(join(GOLDEN, file), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { dir: string; line?: string })
    .filter((r) => r.dir === "eng>gui" && typeof r.line === "string" && r.line !== "")
    .map((r) => r.line!);
}

/** 녹취 끝에 덧붙이는 합성 줄 — 여러 줄 주석(한글, 닫히지 않은 따옴표) · 금수. */
const TAIL = [
  'MESSAGE DATABASE TEXT "첫 줄 녹취테스트',
  "둘째 줄 「따옴표」 없음",
  '셋째 줄 끝"',
  "FORBID 07080809.",
];

/** 결정적인 난수(묶음 크기 흔들기). */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

const utf8Bytes = (s: string) => String.fromCharCode(...new TextEncoder().encode(s));

interface Run {
  console: string[];
  db: string[];
  forbid: unknown[];
  lastSnapshot: unknown;
}

async function run(mode: "wasm" | "native", lines: readonly string[], seed: number): Promise<Run> {
  vi.resetModules();
  const posted: FromWorker[] = [];
  let out: (l: string) => void = () => undefined;
  /** 엔진 줄을 곧바로(동기로) 넘긴다 — 재생용. */
  let feed: (batch: readonly string[]) => void = () => undefined;
  g.self = g;
  g.importScripts = () => undefined;
  const answer = (head: string) => {
    if (head.startsWith("START")) out("OK");
    if (head === "ABOUT") out('name="Rapfi", version="golden"');
    if (head === "yxshowinfo") out("MESSAGE INFO MAX_THREAD_NUM 256");
  };
  if (mode === "wasm") {
    g.postMessage = (m: FromWorker) => posted.push(m);
    g.Rapfi = async (opts: { onReceiveStdout: (line: string) => void }) => {
      feed = (batch) => batch.forEach((l) => opts.onReceiveStdout(utf8Bytes(l)));
      out = (l) => setTimeout(() => feed([l]), 1);
      return {
        sendCommand: (data: string) => answer(data.split("\n")[0]!),
        terminate() {},
      };
    };
  } else {
    // 네이티브: 워커의 `wire` 가 셸 쓰기 자리, `wireIn` 이 셸 사건 자리.
    feed = (batch) => (g.onmessage as Handler)({ data: { type: "wireIn", lines: batch } });
    out = (l) => setTimeout(() => feed([l]), 1);
    g.postMessage = (m: FromWorker) => {
      if (m.type === "wire") for (const head of m.text.split("\n")) answer(head);
      else posted.push(m);
    };
  }
  await import("./engine-worker");
  const send = (m: ToWorker) => (g.onmessage as Handler)({ data: m });
  send({
    type: "boot",
    engineBaseUrl: "/engine/",
    variant: mode === "wasm" ? "multi-simd128" : "native",
    sliceMs: 500,
    size: 15,
    handshakeMs: 2_000,
    ...(mode === "native" ? { native: true } : {}),
  } as ToWorker);
  await until(() => posted.some((m) => m.type === "booted" || m.type === "fatal"));
  expect(posted.find((m) => m.type === "fatal")).toBeUndefined();
  await sleep(150); // 기동 콘솔 줄을 비워 둔다
  const mark = posted.length;

  // 셸처럼 프레임으로 — 묶음 크기는 무작위(WASM 은 묶음 안에서도 줄 하나씩). 프레임 사이에 이벤트 루프로
  // 돌아가 콘솔 배치(100ms, 상한 5000줄)가 실제처럼 비워진다.
  const rnd = lcg(seed);
  for (let i = 0; i < lines.length;) {
    const n = 1 + Math.floor(rnd() * 40);
    feed(lines.slice(i, i + n));
    i += n;
    if (i % 400 < n) await sleep(2);
  }
  await sleep(150);
  // 마지막 스냅샷이 줄 전부를 담게 — 스로틀(100ms)이 지난 뒤 상태를 건드리는 줄 하나.
  feed(["INFO TOTALNODES 1"]);
  await sleep(150);

  const after = posted.slice(mark);
  const snaps = after.filter((m) => m.type === "snapshot");
  return {
    console: after.flatMap((m) => (m.type === "console" ? m.lines : [])),
    db: after.flatMap((m) => (m.type === "dbLine" ? [m.text] : [])),
    forbid: after.flatMap((m) => (m.type === "forbid" ? [m.cells] : [])),
    lastSnapshot: (snaps.at(-1) as { snapshot?: unknown } | undefined)?.snapshot ?? null,
  };
}

describe("골든 녹취 재생 — 네이티브 경로 = WASM 멀티 경로", () => {
  it("녹취 파일이 있다", () => expect(goldenFiles.length).toBeGreaterThanOrEqual(5));

  it.each(goldenFiles)(
    "%s",
    async (file) => {
      const lines = [...engineLines(file), ...TAIL];
      const wasm = await run("wasm", lines, 1);
      const native = await run("native", lines, file.length * 7919);

      // 해석이 같다.
      expect(native.db).toEqual(wasm.db);
      expect(native.forbid).toEqual(wasm.forbid);
      expect(native.lastSnapshot).toEqual(wasm.lastSnapshot);
      // 분석 줄이 있는 녹취는 스냅샷이 실제로 나왔다(빈 것끼리의 비교가 아니다).
      if (lines.some((l) => l.startsWith("INFO PV"))) expect(native.lastSnapshot).not.toBeNull();
      // 줄이 하나도 빠지거나 바뀌지 않았다 — 녹취 원문 그대로(한글 포함).
      expect(native.console).toEqual([...lines, "INFO TOTALNODES 1"]);
      expect(wasm.console).toEqual(native.console);
      // 여러 줄 주석은 이어지는 줄까지 DB 쪽으로 간다.
      expect(native.db.slice(-3)).toEqual(
        TAIL.slice(0, 3).map((l, i) => (i === 0 ? l.slice(8) : l)),
      );
      expect(native.forbid.length).toBeGreaterThan(0);
    },
    30_000,
  );
});
