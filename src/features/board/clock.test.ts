import { beforeEach, describe, expect, it } from "vitest";
import {
  addIncrement,
  engineTimeLeftMs,
  formatClock,
  freshClock,
  leftLabel,
  leftMatchMs,
  leftTurnMs,
  playerTimedOut,
  startClock,
  tickClock,
  usedLabel,
} from "../../core/model/clock";
import { limitsOf, tickClockNow, useClockStore, CLOCK_DEFAULTS } from "./clockStore";
import { useGameStore } from "./gameStore";
import { getGameHandlers, useEngineStore } from "../../engine/engine-state";
import { move } from "../../core/model/move";
import type { Placement } from "../../engine/engine-types";

/**
 * 대국 시계(데스크톱 Z4) — 앱 `GameClock.kt` 와 같은 계산(데스크톱 main.c:11713 / 11875), 그리고 대국이 시계를
 * 넘기는 자리(사람 착수 → 엔진 차례 → 엔진 착수)와 엔진에 주는 예산.
 */

const LIMITS = { limited: true, turnLimitMs: 10_000, matchLimitMs: 60_000, incrementMs: 2_000 };

describe("시계 계산", () => {
  it("차례를 넘기면 다른 쪽의 덜 끝난 차례가 대국 합계로 접힌다", () => {
    let c = freshClock(LIMITS, "human");
    c = tickClock(c, 4_000);
    c = startClock(c, "computer");
    expect(c).toMatchObject({ humanMatchMs: 4_000, humanTurnMs: 0, running: "computer" });
    c = tickClock(c, 3_000);
    c = startClock(c, "human");
    expect(c).toMatchObject({ computerMatchMs: 3_000, computerTurnMs: 0 });
  });

  it("남은 시간 = 대국 한도 − 쓴 시간 + 번 증분, 차례 남은 시간은 둘 중 작은 것", () => {
    let c = freshClock(LIMITS, "human");
    c = tickClock(c, 55_000);
    expect(leftMatchMs(c, "human")).toBe(5_000);
    expect(leftTurnMs(c, "human")).toBe(0); // 차례 한도 10초를 넘겼다
    c = addIncrement(c, "human");
    expect(leftMatchMs(c, "human")).toBe(7_000);
    expect(playerTimedOut(c)).toBe(true);
  });

  it("엔진의 time_left 는 끝낸 차례만 뺀다(진행 중인 차례는 빼지 않는다, main.c:2742)", () => {
    let c = startClock(freshClock(LIMITS), "computer");
    c = tickClock(c, 5_000);
    expect(engineTimeLeftMs(c)).toBe(60_000);
    c = addIncrement(startClock(c, "human"), "computer");
    expect(engineTimeLeftMs(c)).toBe(57_000);
  });

  it("라벨 — hh:mm:ss, 제한이 없으면 99:59:59", () => {
    expect(formatClock(3_725_000)).toBe("01:02:05");
    expect(formatClock(400 * 3_600_000)).toBe("99:59:59");
    const c = tickClock(freshClock(LIMITS, "human"), 1_500);
    expect(leftLabel(c, "human")).toBe("00:00:08 / 00:00:58");
    expect(usedLabel(c, "human")).toBe("00:00:01 / 00:00:01");
    expect(leftLabel(freshClock({ ...LIMITS, limited: false }), "human")).toBe(
      "99:59:59 / 99:59:59",
    );
  });

  it("차례 한도는 엔진 착수 시간, 무제한이면 대국 한도", () => {
    const s = { ...CLOCK_DEFAULTS, enabled: true, matchSec: 300, incrementSec: 5 };
    expect(limitsOf(s, 3_000)).toEqual({
      limited: true,
      matchLimitMs: 300_000,
      turnLimitMs: 3_000,
      incrementMs: 5_000,
    });
    expect(limitsOf(s, 0).turnLimitMs).toBe(300_000);
  });
});

describe("대국이 시계를 넘긴다", () => {
  const plays: { stones: readonly Placement[]; budget: unknown }[] = [];
  const g = () => useGameStore.getState();
  const c = () => useClockStore.getState().clock;

  beforeEach(() => {
    plays.length = 0;
    useEngineStore.setState({
      status: "idle",
      send: () => undefined,
      play: async (stones, _empty, budget) => void plays.push({ stones, budget }),
    });
    useClockStore.getState().setSettings({
      enabled: true,
      matchSec: 60,
      incrementSec: 2,
      checkTimeout: true,
    });
    useGameStore.setState({
      mode: "game",
      rule: "renju",
      computerSide: "white",
      opening: "none",
      moveTimeMs: 0,
    });
    g().setMoveTime(5_000);
    g().newGame();
  });

  it("사람이 두면 증분을 벌고 엔진 차례로, 엔진이 두면 엔진이 벌고 사람 차례로", () => {
    expect(c().running).toBe("human");
    tickClockNow(3_000);
    g().tap(move(7, 7));
    expect(c()).toMatchObject({
      running: "computer",
      humanMatchMs: 3_000,
      humanIncrementMs: 2_000,
    });
    // 엔진 예산 — 데스크톱처럼 차례 · 대국 한도와 엔진의 남은 시간.
    expect(plays.at(-1)!.budget).toEqual({ turnMs: 5_000, matchMs: 60_000, matchLeftMs: 60_000 });
    tickClockNow(4_000);
    getGameHandlers().onEngineMove?.([move(8, 8)]);
    expect(c()).toMatchObject({
      running: "human",
      computerMatchMs: 4_000,
      computerIncrementMs: 2_000,
    });
  });

  it("사람의 시간이 다 되면 한 번 알린다", () => {
    tickClockNow(5_001); // 차례 한도 5초
    expect(c().timedOutNotified).toBe(true);
    expect(g().prompt).toMatchObject({ kind: "info" });
    useGameStore.setState({ prompt: null });
    tickClockNow(1_000);
    expect(g().prompt).toBeNull();
  });

  it("분석 탭이나 승부가 난 뒤에는 흐르지 않는다", () => {
    useGameStore.setState({ mode: "analysis" });
    tickClockNow(3_000);
    expect(c().humanTurnMs).toBe(0);
    useGameStore.setState({ mode: "game", result: { end: "resigned", winner: "black" } });
    tickClockNow(3_000);
    expect(c().humanTurnMs).toBe(0);
  });

  it("시계를 끄면 예전처럼 한 수 예산만", () => {
    useClockStore.getState().setSettings({ enabled: false });
    g().tap(move(7, 7));
    expect(plays.at(-1)!.budget).toEqual({ turnMs: 5_000, matchMs: 0 });
  });
});
