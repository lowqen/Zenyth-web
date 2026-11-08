import { describe, expect, it } from "vitest";
import {
  NativeTransport,
  WasmTransport,
  parseRemoteAddress,
  type NativeBridge,
  type NativeEvent,
} from "./engine-transport";
import type { FromWorker, ToWorker } from "./engine-types";

/** 워커 대신 — 받은 메시지를 모으고, `emit` 으로 워커가 낸 것처럼 꾸민다. */
function fakeWorker() {
  const got: ToWorker[] = [];
  let terminated = false;
  const w = {
    onmessage: null as ((ev: MessageEvent<FromWorker>) => void) | null,
    onerror: null as ((e: Event) => void) | null,
    onmessageerror: null as ((e: Event) => void) | null,
    postMessage: (m: ToWorker) => got.push(m),
    terminate: () => (terminated = true),
  };
  return {
    got,
    terminated: () => terminated,
    emit: (m: FromWorker) => w.onmessage?.({ data: m } as MessageEvent<FromWorker>),
    spawn: () => w as unknown as Worker,
    w,
  };
}

/** 셸 대신 — open 은 손으로 풀고, write 는 하나씩 붙잡아 차례를 본다. */
function fakeBridge() {
  const writes: string[] = [];
  const closed: number[] = [];
  let onEvent: ((e: NativeEvent) => void) | null = null;
  let resolveOpen: ((id: number) => void) | null = null;
  let rejectOpen: ((e: unknown) => void) | null = null;
  let releaseWrite: (() => void) | null = null;
  let failWrite = false;
  const bridge: NativeBridge = {
    open: (_spec, cb) => {
      onEvent = cb;
      return new Promise<number>((res, rej) => {
        resolveOpen = res;
        rejectOpen = rej;
      });
    },
    write: (_id, text) => {
      writes.push(text);
      if (failWrite) return Promise.reject(new Error("broken pipe"));
      return new Promise<void>((res) => (releaseWrite = res));
    },
    close: (id) => {
      closed.push(id);
      return Promise.resolve();
    },
  };
  return {
    bridge,
    writes,
    closed,
    resolve: (id: number) => resolveOpen?.(id),
    reject: (e: unknown) => rejectOpen?.(e),
    release: () => releaseWrite?.(),
    breakWrites: () => (failWrite = true),
    event: (e: NativeEvent) => onEvent?.(e),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const boot: ToWorker = {
  type: "boot",
  variant: "single",
  base: "",
  weightsUrl: "",
  settings: [],
  warmupMs: 0,
  handshakeMs: 60_000,
  native: true,
} as unknown as ToWorker;

function setup() {
  const w = fakeWorker();
  const b = fakeBridge();
  const tr = new NativeTransport(w.spawn, b.bridge, { kind: "local", path: "" });
  const out: FromWorker[] = [];
  tr.onmessage = (m) => out.push(m);
  return { w, b, tr, out };
}

describe("WasmTransport", () => {
  it("워커 메시지를 그대로 넘기고, 오류는 사람이 읽을 글로 편다", () => {
    const w = fakeWorker();
    const tr = new WasmTransport(w.spawn);
    const out: FromWorker[] = [];
    const errs: string[] = [];
    tr.onmessage = (m) => out.push(m);
    tr.onerror = (e) => errs.push(e);
    w.emit({ type: "exit", code: 0 } as FromWorker);
    w.w.onerror?.({ type: "error", message: "boom" } as unknown as Event);
    expect(out).toEqual([{ type: "exit", code: 0 }]);
    expect(errs[0]).toMatch(/boom/);
    tr.post({ type: "wireIn", lines: ["x"] });
    expect(w.got).toEqual([{ type: "wireIn", lines: ["x"] }]);
    tr.terminate();
    expect(w.terminated()).toBe(true);
  });
});

describe("NativeTransport", () => {
  it("세션이 열릴 때까지 메시지를 붙잡았다가 차례대로 넘긴다", async () => {
    const { w, b, tr } = setup();
    tr.post(boot);
    tr.post({ type: "wireIn", lines: ["early"] });
    expect(w.got).toEqual([]);
    b.resolve(7);
    await tick();
    expect(w.got.map((m) => m.type)).toEqual(["boot", "wireIn"]);
  });

  it("셸의 줄 묶음은 wireIn, 끝은 wireExit 로 워커에 간다", async () => {
    const { w, b, tr } = setup();
    tr.post(boot);
    b.resolve(1);
    await tick();
    b.event({ event: "lines", data: { lines: ["OK", "MESSAGE a"] } });
    b.event({ event: "exit", data: { code: 3, error: "엔진 프로세스가 종료했습니다 (코드 3)" } });
    b.event({ event: "exit", data: { code: 0, error: null } });
    expect(w.got.slice(1)).toEqual([
      { type: "wireIn", lines: ["OK", "MESSAGE a"] },
      { type: "wireExit", code: 3, error: "엔진 프로세스가 종료했습니다 (코드 3)" },
      { type: "wireExit", code: 0 },
    ]);
  });

  it("워커의 wire 는 밖으로 내보내지 않고 셸에 쓴다 — 쓰는 동안 쌓인 것은 한 번에 묶는다", async () => {
    const { w, b, tr, out } = setup();
    tr.post(boot);
    b.resolve(1);
    await tick();
    w.emit({ type: "wire", text: "START 15" });
    w.emit({ type: "wire", text: "INFO rule 4" });
    w.emit({ type: "wire", text: "YXSHOWINFO" });
    expect(b.writes).toEqual(["START 15"]);
    b.release();
    await tick();
    expect(b.writes).toEqual(["START 15", "INFO rule 4\nYXSHOWINFO"]);
    expect(out).toEqual([]);
    w.emit({ type: "booted" } as FromWorker);
    expect(out).toEqual([{ type: "booted" }]);
  });

  it("쓰기가 실패하면 워커에 wireExit(오류)를 넘기고 남은 줄을 버린다", async () => {
    const { w, b, tr } = setup();
    tr.post(boot);
    b.resolve(1);
    await tick();
    b.breakWrites();
    w.emit({ type: "wire", text: "BOARD" });
    await tick();
    const last = w.got.at(-1) as Extract<ToWorker, { type: "wireExit" }>;
    expect(last.type).toBe("wireExit");
    expect(last.error).toMatch(/broken pipe/);
  });

  it("열지 못하면 fatal — 기동 실패로 읽혀 WASM 으로 물러선다", async () => {
    const { w, b, tr, out } = setup();
    tr.post(boot);
    b.reject(new Error("program not found"));
    await tick();
    expect(w.got).toEqual([]);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("fatal");
    expect((out[0] as { message: string }).message).toMatch(/program not found/);
  });

  it("terminate 는 세션을 닫고 워커를 끝낸다 — 그 뒤의 사건은 버린다", async () => {
    const { w, b, tr } = setup();
    tr.post(boot);
    b.resolve(9);
    await tick();
    tr.terminate();
    expect(b.closed).toEqual([9]);
    expect(w.terminated()).toBe(true);
    const n = w.got.length;
    b.event({ event: "lines", data: { lines: ["late"] } });
    tr.post({ type: "wireIn", lines: ["x"] });
    expect(w.got.length).toBe(n);
  });

  it("열리기 전에 끝내면 늦게 열린 세션도 닫는다", async () => {
    const { b, tr } = setup();
    tr.post(boot);
    tr.terminate();
    b.resolve(4);
    await tick();
    expect(b.closed).toEqual([4]);
  });
});

describe("parseRemoteAddress", () => {
  it.each([
    ["rapfi-server", { host: "rapfi-server", port: 5050 }],
    ["100.64.0.1:6000", { host: "100.64.0.1", port: 6000 }],
    ["[fd7a::1]:7000", { host: "fd7a::1", port: 7000 }],
    ["  host:1  ", { host: "host", port: 1 }],
  ])("%s", (s, want) => expect(parseRemoteAddress(s)).toEqual(want));

  it.each(["", "a b", "host:0", "host:70000", "host:port", "fd7a::1"])("거절: %s", (s) =>
    expect(parseRemoteAddress(s)).toBeNull(),
  );
});
