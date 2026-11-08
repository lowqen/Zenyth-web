import { describe, expect, it } from "vitest";
import { hotkeyName, importYixinFunction, parseSteps, type HotkeyLike } from "./commandText";
import { rankEntries } from "./palette";

const key = (k: string, mods: Partial<Omit<HotkeyLike, "key">> = {}): HotkeyLike => ({
  key: k,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe("사용자 명령 글 (데스크톱 Z4)", () => {
  it("단계 — @앱 명령 · 엔진 줄 · 주석 · 빈 줄", () => {
    expect(parseSteps("@board.first\r\n\n# 주석\n  YXHASHCLEAR  \n@ \nINFO max_node 1000")).toEqual(
      [
        { kind: "app", id: "board.first" },
        { kind: "engine", line: "YXHASHCLEAR" },
        { kind: "engine", line: "INFO max_node 1000" },
      ],
    );
  });

  it("Yixin 툴바 — 아는 명령은 @id, command on/off 사이는 엔진 줄, 나머지는 못 옮김", () => {
    const r = importYixinFunction(
      "3\nundo\n\nUndo All\nthinking start\ncommand on\nYXHASHCLEAR\ncommand off\nblockautoreset\n",
    );
    expect(r.icon).toBe("undo");
    expect(r.steps).toBe("@board.first\n@analysis.start\nYXHASHCLEAR");
    expect(r.unsupported).toEqual(["blockautoreset"]);
  });

  it("Yixin 단축키 — 아이콘 줄이 비어 있다", () => {
    const r = importYixinFunction("1\n\n\nclear\n");
    expect(r.icon).toBeNull();
    expect(r.steps).toBe("@board.new");
    expect(r.unsupported).toEqual([]);
  });

  it("단축키 이름 — Ctrl · Alt 가 붙거나 F 키만, 글 쓰는 키 · 수식키만 · Meta 는 안 된다", () => {
    expect(hotkeyName(key("k", { ctrlKey: true, altKey: true }))).toBe("Ctrl+Alt+K");
    expect(hotkeyName(key("F2"))).toBe("F2");
    expect(hotkeyName(key("F2", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+F2");
    expect(hotkeyName(key("ArrowUp", { altKey: true }))).toBe("Alt+ArrowUp");
    expect(hotkeyName(key("a"))).toBeNull();
    expect(hotkeyName(key("A", { shiftKey: true }))).toBeNull();
    expect(hotkeyName(key("Control", { ctrlKey: true }))).toBeNull();
    expect(hotkeyName(key("k", { metaKey: true, ctrlKey: true }))).toBeNull();
    expect(hotkeyName(key("F13"))).toBeNull();
  });

  it("팔레트 고르기 — 이름 머리 → 이름 속 → 묶음 · id, 빈 글은 전부", () => {
    const es = [
      { key: "a.x", title: "분석 정지", group: "분석" },
      { key: "b.y", title: "새 판", group: "판" },
      { key: "a.z", title: "분석 시작", group: "분석" },
      { key: "c.stop", title: "엔진 종료", group: "엔진" },
    ];
    expect(rankEntries(es, "")).toEqual(es);
    expect(rankEntries(es, "분석").map((e) => e.key)).toEqual(["a.x", "a.z"]);
    expect(rankEntries(es, "정지").map((e) => e.key)).toEqual(["a.x"]);
    expect(rankEntries(es, "STOP").map((e) => e.key)).toEqual(["c.stop"]);
    expect(rankEntries(es, "없는 말")).toEqual([]);
  });
});
