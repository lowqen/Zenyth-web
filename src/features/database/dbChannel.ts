import { DbAggregator, type DbLine, type DbSnapshot } from "../../core/database/yixindb";
import type { Move } from "../../core/model/move";
import type { EngineCommand } from "../../engine/engine-types";
import { t } from "../../i18n/i18n";

/**
 * 엔진과 yixindb 가 말하는 길 하나 — 명령을 보내고, 그 명령의 끝을 알리는 줄을 기다린다.
 *
 * DB 명령은 **한 번에 하나**다. 답이 `DATABASE …` 줄 묶음일 뿐 어느 요청의 답인지 꼬리표가 없어서
 * (데스크톱은 `dbqueryseq`/`dbdoneseq` 로 센다) 겹쳐 보내면 앞 요청이 뒤 요청의 `DONE` 을 가져간다.
 * 그래서 요청은 줄을 서고, 앞 요청이 끝(또는 시간 끝)나야 다음이 나간다.
 *
 * 엔진이 DB 를 쥐고 있지 않으면 질의에 **아무 답도 하지 않는다**(`if (ctx.storage)`). 그래서
 * 모든 요청에 시간 끈이 있다 — 끈이 끊기면 `null` 이고, 부르는 쪽은 «답 없음»으로 읽는다.
 *
 * **늦은 답(데스크톱 Z3, 원격 엔진)**: 시간 끈이 끊긴 요청의 답이 뒤늦게 올 수 있다. 그 줄을 다음 요청이
 * 제 답으로 읽으면 안 된다(데스크톱의 `dbqueryseq`/`dbdoneseq` 가 막는 바로 그 어긋남). 그래서 끊긴 요청은
 * «빚»으로 남아 `LATE_REPLY_MS` 동안 들어오는 줄을 먼저 가져간다 — 제 끝 줄(또는 ERROR)이 오면 갚은 것이다.
 * 빚은 오래된 것부터 갚는다(엔진은 받은 차례대로 답한다). 끝내 답이 없는 요청(DB 없는 엔진)의 빚은 기한이
 * 지나면 버린다. 엔진이 바뀌거나 DB 를 새로 붙이면 `resetPairing()` 으로 빚을 지운다 — 새 엔진은 옛 요청에
 * 답하지 않는다(Z0 녹취: «페어링은 답 없는 조회를 견뎌야 한다»).
 */

export interface DbPort {
  send(cmd: EngineCommand): void;
  /** 워커가 넘기는 DB 줄을 듣는다. 끊는 함수를 돌려준다. */
  listen(fn: (line: string) => void): () => void;
}

export interface DbReply {
  /** 이 요청 동안 받은 줄(주석의 이어지는 줄은 닫힌 `text` 하나로). */
  lines: DbLine[];
  snapshot: DbSnapshot;
}

const DEFAULT_TIMEOUT_MS = 8_000;
/** 끊긴 요청의 늦은 답을 받아 줄 기한. 원격 왕복 지연보다 넉넉하게. */
export const LATE_REPLY_MS = 30_000;

type Until = (l: DbLine, seen: readonly DbLine[]) => boolean;
interface Owed {
  until: Until;
  seen: DbLine[];
  expiresAt: number;
}

export class DbChannel {
  readonly agg: DbAggregator;
  private chain: Promise<unknown> = Promise.resolve();
  private waiter: ((l: DbLine) => void) | null = null;
  private owed: Owed[] = [];
  private unlisten: () => void;

  constructor(
    private readonly port: DbPort,
    size: number,
    fromWire: (row: number, col: number) => Move,
    /** 요청 밖에서 온 줄도 포함해 줄마다 — 화면의 기록용. */
    private readonly onLine?: (l: DbLine) => void,
    private readonly now: () => number = Date.now,
  ) {
    this.agg = new DbAggregator(size, fromWire);
    this.unlisten = port.listen((text) => {
      const l = this.agg.consume(text);
      if (!l) return;
      this.onLine?.(l);
      if (this.payDebt(l)) return;
      this.waiter?.(l);
    });
  }

  /** 줄이 끊긴 요청의 늦은 답이면 그 빚에 넘기고 참. */
  private payDebt(l: DbLine): boolean {
    const now = this.now();
    this.owed = this.owed.filter((o) => o.expiresAt > now);
    const debt = this.owed[0];
    if (!debt) return false;
    debt.seen.push(l);
    if (l.kind === "error" || debt.until(l, debt.seen)) this.owed.shift();
    return true;
  }

  /** 끊긴 요청의 빚을 모두 지운다 — 엔진이 바뀌었거나 DB 를 새로 붙일 때. */
  resetPairing(): void {
    this.owed = [];
  }

  close(): void {
    this.unlisten();
  }

  /**
   * 명령을 보내고 `until` 이 참인 줄을 기다린다. `until` 이 없으면 보내기만 한다(답하지 않는
   * 명령 — 주석 · 칸 글자 · 기록 하나 지우기). ERROR 는 곧장 끝낸다.
   */
  request(
    cmd: EngineCommand,
    until: Until | null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<DbReply | null> {
    const run = () =>
      new Promise<DbReply | null>((resolve) => {
        if (!until) {
          this.port.send(cmd);
          resolve({ lines: [], snapshot: this.agg.snapshot() });
          return;
        }
        const lines: DbLine[] = [];
        const finish = (ok: boolean) => {
          clearTimeout(timer);
          this.waiter = null;
          // 끊겼다 — 이미 받은 줄을 안고 빚으로 남는다. 나머지 답은 다음 요청이 아니라 이 빚이 가져간다.
          // 빚이 남은 채 또 끊겼다면 짝이 이미 틀어진 것이다(앞 빚이 남의 답을 먹었을 수 있다) — 빚을 쌓지
          // 않고 모두 지운다. 끊김이 줄줄이 번지지 않게.
          if (!ok) {
            if (this.owed.length > 0) this.owed = [];
            else this.owed.push({ until, seen: lines, expiresAt: this.now() + LATE_REPLY_MS });
          }
          resolve(ok ? { lines, snapshot: this.agg.snapshot() } : null);
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        this.waiter = (l) => {
          lines.push(l);
          if (l.kind === "error") finish(true);
          else if (until(l, lines)) finish(true);
        };
        this.port.send(cmd);
      });
    const p = this.chain.then(run, run);
    this.chain = p;
    return p;
  }
}

// ── 흔한 끝맺음 ───────────────────────────────────────────────────────

/** `yxquerydatabaseallt` — 칸들 · `DONE` 뒤의 `TEXT` 가 끝이다. */
export const untilText = (l: DbLine) => l.kind === "text";
/** `yxquerydatabaseone` · `yxedittvddatabase` — `ONE` 한 줄. */
export const untilOne = (l: DbLine) => l.kind === "one";
/** `yxdeletedatabaseall` — `Done deleting` 뒤의 `DONE`. */
export const untilDeleted = (l: DbLine, seen: readonly DbLine[]) =>
  l.kind === "done" && seen.some((x) => x.kind === "deleted");
/** `yxdbtotxtall` — `Wrote … database to …`. */
export const untilWrote = (l: DbLine) => l.kind === "wrote";

/** 답의 첫 오류 글, 없으면 null. */
export const replyError = (r: DbReply | null): string | null =>
  r === null
    ? t("엔진이 답하지 않았습니다(DB 가 붙어 있지 않을 수 있습니다)")
    : ((r.lines.find((l) => l.kind === "error") as { text: string } | undefined)?.text ?? null);
