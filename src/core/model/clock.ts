/**
 * 대국 시계 — 데스크톱의 네 타이머(`timercomputerturn/match`, `timerhumanturn/match`)와 두 증분 적립을
 * 그대로 옮긴다(`clock_timer_update` · `clock_label_refresh`, main.c:11875 / 11713). 앱(Zenyth)의
 * `GameClock.kt` 와 같은 계산이다(데스크톱 Z4).
 *
 * 「쓴 시간」은 *이번 차례* / *대국 전체*, 「남은 시간」은 대국 한도에서 쓴 시간을 빼고 지금까지 번 증분을
 * 더한 것이다. 시계는 순수 값이다 — 흐르게 하는 것(틱)은 `gameStore` 의 일이다.
 */

/** 데스크톱이 보이는 두 시계: 엔진의 것과 사람의 것. */
export type ClockSide = "computer" | "human";

export interface GameClock {
  /** 시간 제한이 있는가. 없으면 라벨은 99:59:59 이고 시간 초과도 없다. */
  limited: boolean;
  turnLimitMs: number;
  matchLimitMs: number;
  incrementMs: number;
  /** 지금 재는 쪽. 멈췄으면 null. */
  running: ClockSide | null;
  computerMatchMs: number;
  computerTurnMs: number;
  humanMatchMs: number;
  humanTurnMs: number;
  computerIncrementMs: number;
  humanIncrementMs: number;
  /** 사람에게 시간 초과를 한 번 알렸다(데스크톱의 `timeoutflag`). */
  timedOutNotified: boolean;
}

export interface ClockLimits {
  limited: boolean;
  turnLimitMs: number;
  matchLimitMs: number;
  incrementMs: number;
}

export function freshClock(limits: ClockLimits, running: ClockSide | null = null): GameClock {
  return {
    ...limits,
    running,
    computerMatchMs: 0,
    computerTurnMs: 0,
    humanMatchMs: 0,
    humanTurnMs: 0,
    computerIncrementMs: 0,
    humanIncrementMs: 0,
    timedOutNotified: false,
  };
}

/** 설정이 바뀌었다 — 이미 쓴 시간은 두고 한도만 바꾼다. */
export const withLimits = (c: GameClock, l: ClockLimits): GameClock => ({ ...c, ...l });

/**
 * 시계를 `side` 에게 넘긴다. 다른 쪽의 덜 끝난 차례는 그쪽 대국 합계에 접힌다 — 데스크톱의 틱이 상태가 바뀔
 * 때 하는 일과 같다.
 */
export function startClock(c: GameClock, side: ClockSide): GameClock {
  return side === "computer"
    ? {
        ...c,
        running: side,
        humanMatchMs: c.humanMatchMs + c.humanTurnMs,
        humanTurnMs: 0,
        computerTurnMs: 0,
      }
    : {
        ...c,
        running: side,
        computerMatchMs: c.computerMatchMs + c.computerTurnMs,
        computerTurnMs: 0,
        humanTurnMs: 0,
      };
}

export const stopClock = (c: GameClock): GameClock => ({ ...c, running: null });

export function tickClock(c: GameClock, deltaMs: number): GameClock {
  if (c.running === "computer") return { ...c, computerTurnMs: c.computerTurnMs + deltaMs };
  if (c.running === "human") return { ...c, humanTurnMs: c.humanTurnMs + deltaMs };
  return c;
}

/** 한 수를 마치면 증분을 번다(`timer*increment += increment`). */
export function addIncrement(c: GameClock, side: ClockSide): GameClock {
  return side === "computer"
    ? { ...c, computerIncrementMs: c.computerIncrementMs + c.incrementMs }
    : { ...c, humanIncrementMs: c.humanIncrementMs + c.incrementMs };
}

export const usedTurnMs = (c: GameClock, side: ClockSide): number =>
  side === "computer" ? c.computerTurnMs : c.humanTurnMs;

export const usedMatchMs = (c: GameClock, side: ClockSide): number =>
  side === "computer" ? c.computerMatchMs + c.computerTurnMs : c.humanMatchMs + c.humanTurnMs;

export function leftMatchMs(c: GameClock, side: ClockSide): number {
  const credit = side === "computer" ? c.computerIncrementMs : c.humanIncrementMs;
  return Math.max(0, c.matchLimitMs - usedMatchMs(c, side) + credit);
}

export const leftTurnMs = (c: GameClock, side: ClockSide): number =>
  Math.max(0, Math.min(c.turnLimitMs - usedTurnMs(c, side), leftMatchMs(c, side)));

/**
 * 엔진 차례마다 데스크톱이 보내는 `INFO time_left` — 대국 한도에서 엔진이 **끝낸** 차례들을 빼고 번 증분을
 * 더한다. 진행 중인 차례는 일부러 빼지 않는다(main.c:2742).
 */
export const engineTimeLeftMs = (c: GameClock): number =>
  Math.max(0, c.matchLimitMs - c.computerMatchMs + c.computerIncrementMs);

/** 데스크톱은 **사람의** 시계만 경고한다 — 사람 라벨을 계산한 뒤에 시간 초과를 본다(main.c:11866). */
export const playerTimedOut = (c: GameClock): boolean =>
  c.limited && (leftTurnMs(c, "human") <= 0 || leftMatchMs(c, "human") <= 0);

const UNLIMITED = "99:59:59";

/** `hh:mm:ss` — 데스크톱 라벨처럼 99:59:59 에서 멈춘다. */
export function formatClock(ms: number): string {
  const safe = Math.max(0, ms);
  if (Math.floor(safe / 3_600_000) >= 100) return UNLIMITED;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(safe / 3_600_000))}:${p(Math.floor(safe / 60_000) % 60)}:${p(Math.floor(safe / 1000) % 60)}`;
}

/** 남은 시간 라벨 «차례 / 대국». */
export const leftLabel = (c: GameClock, side: ClockSide): string =>
  c.limited
    ? `${formatClock(leftTurnMs(c, side))} / ${formatClock(leftMatchMs(c, side))}`
    : `${UNLIMITED} / ${UNLIMITED}`;

/** 쓴 시간 라벨 «차례 / 대국». */
export const usedLabel = (c: GameClock, side: ClockSide): string =>
  `${formatClock(usedTurnMs(c, side))} / ${formatClock(usedMatchMs(c, side))}`;
