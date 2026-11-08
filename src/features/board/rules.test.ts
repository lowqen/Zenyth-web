import { beforeEach, describe, expect, it } from "vitest";
import { useGameStore } from "./gameStore";
import { useBoardStore } from "./boardStore";
import { useEngineStore } from "../../engine/engine-state";
import { move } from "../../core/model/move";
import { researchBlockedBy } from "../../core/model/rules";
import type { EngineCommand } from "../../engine/engine-types";

/**
 * 규칙(데스크톱 Z4) — 프리스타일 · 스탠다드는 네이티브 · 원격 엔진에서만, 대국 · 분석만. 엔진 없이 돈다:
 * 엔진 스토어의 `send` 를 기록기로 갈아 끼우고 판정 · 금수 · 개시 · 엔진 규칙 번호만 본다.
 */

const sent: EngineCommand[] = [];
const g = () => useGameStore.getState();

function fresh(pref: "auto" | "native" | "remote") {
  sent.length = 0;
  useEngineStore.setState({
    status: "idle",
    enginePreference: pref,
    ruleId: 4,
    send: (...cmds: EngineCommand[]) => void sent.push(...cmds),
  });
  useGameStore.setState({
    mode: "game",
    rule: "renju",
    ruleNotice: null,
    opening: "none",
    computerSide: "none",
  });
  g().newGame();
}

/** 흑 여섯 줄(가로 0..5, 마지막 수가 가운데를 메운다) — 백은 띄엄띄엄. */
function overlineBlack() {
  const black = [0, 1, 2, 4, 5, 3].map((x) => move(x, 7));
  const white = [0, 2, 4, 6, 8].map((x) => move(x, 0));
  return black.flatMap((b, i) => (i < white.length ? [b, white[i]!] : [b]));
}

describe("규칙 바꾸기", () => {
  beforeEach(() => fresh("native"));

  it("브라우저 엔진이면 렌주 밖을 고르지 않고 까닭을 남긴다", () => {
    fresh("auto");
    g().setRule("freestyle");
    expect(g().rule).toBe("renju");
    expect(g().ruleNotice).toMatch(/데스크톱/);
    expect(useEngineStore.getState().ruleId).toBe(4);
  });

  it("네이티브 엔진이면 바뀌고, 개시는 「없음」, 엔진 규칙 번호도 따라간다", () => {
    useGameStore.setState({ opening: "rif" });
    g().setRule("standard");
    expect(g()).toMatchObject({ rule: "standard", opening: "none", ruleNotice: null });
    expect(useEngineStore.getState().ruleId).toBe(1);
    // 렌주 개시는 고를 수 없다.
    g().setOpening("rif");
    expect(g().opening).toBe("none");
    g().setRule("renju");
    expect(useEngineStore.getState().ruleId).toBe(4);
    g().setOpening("rif");
    expect(g().opening).toBe("rif");
  });

  it("장목 — 스탠다드는 이기지 못하고, 프리스타일 · 렌주(백 장목 규칙과 같은 판정)는 이긴다", () => {
    g().setRule("standard");
    g().loadMoves(overlineBlack());
    expect(g().result).toBeNull();
    g().setRule("freestyle");
    g().loadMoves(overlineBlack());
    expect(g().result?.winner).toBe("black");
  });

  it("렌주 밖에서는 금수를 묻지도 보이지도 않는다", () => {
    useEngineStore.setState({ status: "ready" });
    useGameStore.setState({ showForbidden: true });
    g().setRule("freestyle");
    sent.length = 0;
    g().refreshForbidden();
    expect(sent.some((c) => c.kind === "yxshowforbid")).toBe(false);
    expect(useBoardStore.getState().forbidden).toEqual([]);
  });

  it("연구 도구는 렌주에서만 열린다", () => {
    expect(researchBlockedBy("renju")).toBeNull();
    expect(researchBlockedBy("freestyle")).toMatch(/렌주 전용/);
  });
});
