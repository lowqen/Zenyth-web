import type { FromWorker, NativeEngineSpec, ToWorker } from "./engine-types";
import type { NativeBuilds } from "./engine-client";
import { t } from "../i18n/i18n";

/**
 * 엔진 전송 계층(데스크톱 Z3) — `EngineClient` 와 엔진 사이의 길.
 *
 * 클라이언트는 `ToWorker` 를 보내고 `FromWorker` 를 받을 뿐, 그 너머가 워커인지 셸인지 모른다.
 *
 *   - `WasmTransport`   웹 배포 · 데스크톱 기본 — 워커 안의 Emscripten 엔진(지금까지 그대로).
 *   - `NativeTransport` 데스크톱 — **같은 워커 번들**을 띄우되 글루 대신 셸의 엔진 프로세스 · TCP 에 잇는다.
 *                       세션 논리(탐색 줄 세우기 · 정지 · 정착 대기 · 감시견 · 줄 조립 · 집계)는 워커 하나에만
 *                       있다 — 두 벌로 나누면 사본 대조 문제가 생긴다(계획 §5.A «컴포넌트 분리 원칙»).
 *
 * 셸 쪽은 `NativeBridge` 로만 들어온다 — `src/engine` 은 Tauri 를 모른다(`app/desktop/nativeBridge.ts` 가 짝).
 */
export interface EngineTransport {
  post(m: ToWorker, transfer?: Transferable[]): void;
  /** 엔진 쪽 사건. 클라이언트가 건다. */
  onmessage: ((m: FromWorker) => void) | null;
  /** 전송 자체의 고장(워커 오류 · 복제 실패) — 사람이 읽을 글. */
  onerror: ((text: string) => void) | null;
  terminate(): void;
}

/** 워커 하나를 띄우는 함수 — Vite 가 번들을 알아보는 `new Worker(new URL(…))` 모양은 클라이언트에 남는다. */
export type WorkerFactory = () => Worker;

/** 워커를 그대로 감싼다. 워커 오류 이벤트는 사람이 읽을 글로 편다. */
export class WasmTransport implements EngineTransport {
  onmessage: ((m: FromWorker) => void) | null = null;
  onerror: ((text: string) => void) | null = null;
  private readonly worker: Worker;

  constructor(spawn: WorkerFactory) {
    this.worker = spawn();
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.onmessage?.(ev.data);
    this.worker.onerror = (e) => this.onerror?.(describeWorkerError(e));
    this.worker.onmessageerror = () =>
      this.onerror?.(t("워커 메시지를 복제하지 못했습니다(구조화 복제 실패)"));
  }

  post(m: ToWorker, transfer?: Transferable[]): void {
    if (transfer?.length) this.worker.postMessage(m, transfer);
    else this.worker.postMessage(m);
  }

  terminate(): void {
    this.worker.terminate();
  }
}

/**
 * `String(e)` 로 뭉개면 화면에 «[object Object]» 가 뜬다 — 실제로 그렇게 나와서 한 런을 통째로 헤맸다.
 * 워커 오류 이벤트가 들고 있는 것을 전부 풀어 적는다.
 */
export function describeWorkerError(e: ErrorEvent | Event): string {
  const ev = e as Partial<ErrorEvent>;
  const where = ev.filename ? ` (${ev.filename}:${ev.lineno}:${ev.colno})` : "";
  const what = ev.message || e.type || t("알 수 없는 워커 오류");
  return t("워커 오류: {what}", { what: `${what}${where}` });
}

// ── 네이티브 ─────────────────────────────────────────────────────────

/** 셸이 보내는 엔진 사건 — `engine.rs` 의 `EngineEvent` 와 같은 모양. */
export type NativeEvent =
  /** 엔진이 낸 줄들(16ms 프레임 묶음, 개행 · CR 은 떼었다). */
  | { event: "lines"; data: { lines: string[] } }
  /** 프로세스가 끝났거나 연결이 끊겼다. 정상 종료면 `error` 가 없다. */
  | { event: "exit"; data: { code: number | null; error: string | null } };

/**
 * 셸의 엔진 세션 API. `open` 이 세션을 열고 그 세션의 사건을 `onEvent` 로 흘린다(Tauri `Channel` — 순서가
 * 지켜지고, 여는 순간부터 받으므로 첫 줄을 놓치지 않는다). `write` 는 줄 끝 개행을 셸이 붙인다.
 */
export interface NativeBridge {
  open(spec: NativeEngineSpec, onEvent: (e: NativeEvent) => void): Promise<number>;
  write(id: number, text: string): Promise<void>;
  close(id: number): Promise<void>;
  /** 동봉 빌드 목록(엔진 선택창용) — 셸 `engine_builds`. 시험용 다리는 빼도 된다. */
  builds?(): Promise<NativeBuilds>;
}

/**
 * 워커(세션 논리) ↔ 셸(엔진 프로세스 · TCP) 중계.
 *
 *   - 기동 메시지가 오면 먼저 세션을 연다. 열리기 전의 메시지는 붙들었다가 순서대로 넘긴다.
 *   - 워커의 `wire` 는 클라이언트로 올리지 않고 셸에 쓴다. **쓰기는 한 번에 하나**만 날린다 — Tauri 명령은
 *     서로 다른 스레드에서 돌 수 있어 동시에 날리면 엔진에 닿는 순서가 보장되지 않는다(YXBOARD 블록 뒤에
 *     YXNBEST 가 앞서면 빈 판을 읽는다). 날아가는 동안 쌓인 줄은 다음 한 번에 묶어 보낸다.
 *   - 셸의 줄 묶음은 `wireIn` 으로, 끝은 `wireExit` 로 워커에 넘긴다.
 */
export class NativeTransport implements EngineTransport {
  onmessage: ((m: FromWorker) => void) | null = null;
  onerror: ((text: string) => void) | null = null;
  private readonly inner: WasmTransport;
  private session: number | null = null;
  private opening: Promise<void> | null = null;
  private held: { m: ToWorker; transfer?: Transferable[] }[] = [];
  private outbox: string[] = [];
  private writing = false;
  private closed = false;

  constructor(
    spawn: WorkerFactory,
    private readonly bridge: NativeBridge,
    private readonly spec: NativeEngineSpec,
  ) {
    this.inner = new WasmTransport(spawn);
    this.inner.onerror = (text) => this.onerror?.(text);
    this.inner.onmessage = (m) => {
      if (m.type === "wire") this.write(m.text);
      else this.onmessage?.(m);
    };
  }

  post(m: ToWorker, transfer?: Transferable[]): void {
    if (this.closed) return;
    if (m.type === "boot" && this.session === null && !this.opening) {
      this.held.push(transfer ? { m, transfer } : { m });
      this.opening = this.open();
      return;
    }
    if (this.session === null) {
      this.held.push(transfer ? { m, transfer } : { m });
      return;
    }
    this.inner.post(m, transfer);
  }

  private async open(): Promise<void> {
    try {
      const id = await this.bridge.open(this.spec, (e) => this.onEvent(e));
      if (this.closed) {
        void this.bridge.close(id).catch(() => undefined);
        return;
      }
      this.session = id;
      const held = this.held;
      this.held = [];
      for (const h of held) this.inner.post(h.m, h.transfer);
    } catch (e) {
      // 기동 중이므로 클라이언트의 `failBoot` 가 받아 다음 변형(WASM)으로 물러선다.
      if (!this.closed)
        this.onmessage?.({ type: "fatal", message: describeOpenError(this.spec, e) });
    }
  }

  private onEvent(e: NativeEvent): void {
    if (this.closed) return;
    if (e.event === "lines") this.inner.post({ type: "wireIn", lines: e.data.lines });
    else {
      const m: ToWorker = { type: "wireExit", code: e.data.code };
      if (e.data.error) m.error = e.data.error;
      this.inner.post(m);
    }
  }

  private write(text: string): void {
    if (this.closed || this.session === null) return;
    this.outbox.push(text);
    if (!this.writing) void this.pump();
  }

  private async pump(): Promise<void> {
    this.writing = true;
    try {
      while (this.outbox.length && !this.closed && this.session !== null) {
        const batch = this.outbox.join("\n");
        this.outbox = [];
        try {
          await this.bridge.write(this.session, batch);
        } catch (e) {
          // 쓰기가 실패했다 = 프로세스가 죽었거나 연결이 끊겼다. 셸의 `exit` 가 뒤따르지만, 그 전에 남은 줄을
          // 계속 밀어 넣지 않는다.
          this.outbox = [];
          this.inner.post({
            type: "wireExit",
            code: null,
            error: t("엔진에 쓰지 못했습니다: {why}", { why: String(e) }),
          });
          return;
        }
      }
    } finally {
      this.writing = false;
    }
  }

  terminate(): void {
    if (this.closed) return;
    this.closed = true;
    const id = this.session;
    this.session = null;
    this.held = [];
    this.outbox = [];
    if (id !== null) void this.bridge.close(id).catch(() => undefined);
    this.inner.terminate();
  }
}

function describeOpenError(spec: NativeEngineSpec, e: unknown): string {
  const why = e instanceof Error ? e.message : String(e);
  return spec.kind === "local"
    ? t("네이티브 엔진을 띄우지 못했습니다({path}): {why}", {
        path: spec.path || t("기본 위치"),
        why,
      })
    : t("원격 엔진 {addr} 에 붙지 못했습니다: {why}", { addr: `${spec.host}:${spec.port}`, why });
}

// ── 데스크톱이 끼워 넣는 자리 ────────────────────────────────────────

/**
 * 셸 연결. 데스크톱이면 `main.tsx` 가 **첫 기동 전에 동기로** 약속을 끼워 둔다(다리 코드는 동적 import 라
 * 늦게 온다 — 엔진 기동이 그 약속을 기다린다). 웹에서는 언제나 비어 있다.
 */
let bridgePromise: Promise<NativeBridge | null> | null = null;

export function provideNativeBridge(p: Promise<NativeBridge | null>): void {
  bridgePromise = p.catch(() => null);
}

/** 네이티브 엔진을 고를 수 있는 환경인가(동기 — 능력표용). */
export const nativeAvailable = (): boolean => bridgePromise !== null;

export const nativeBridge = (): Promise<NativeBridge | null> =>
  bridgePromise ?? Promise.resolve(null);

/** 셸이 아는 동봉 빌드(엔진 선택창). 웹이거나 셸이 답하지 않으면 null. */
export async function nativeBuilds(): Promise<NativeBuilds | null> {
  try {
    const b = await nativeBridge();
    return (await b?.builds?.()) ?? null;
  } catch {
    return null;
  }
}

/** `"host:port"` 를 푼다. 포트가 없으면 `defaultPort`. 형식이 아니면 null. */
export function parseRemoteAddress(
  s: string,
  defaultPort = 5050,
): { host: string; port: number } | null {
  const v = s.trim();
  if (!v) return null;
  const m = /^(\[[^\]]+\]|[^:\s]+)(?::(\d{1,5}))?$/.exec(v);
  if (!m) return null;
  const port = m[2] === undefined ? defaultPort : Number(m[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: m[1]!.replace(/^\[|\]$/g, ""), port };
}
