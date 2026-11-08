import { beforeEach, describe, expect, it } from "vitest";
import { runUserCommand, useUserCommands } from "./userCommands";
import { appCommands, findCommand } from "./registry";
import { YIXIN_COMMANDS } from "./commandText";

describe("사용자 명령 (데스크톱 Z4)", () => {
  beforeEach(() => useUserCommands.setState({ list: [] }));

  it("Yixin 가져오기 — 번호 차례, 아이콘을 이름에, 옮길 것 없는 파일은 건너뛰고 알린다", () => {
    const notes = useUserCommands.getState().importYixin([
      { name: "toolbar10.txt", text: "10\nredo\n\nredo one\n" },
      { name: "toolbar2.txt", text: "2\nundo\n\nundo one\n" },
      { name: "hotkey1.txt", text: "1\n\n\nblockautoreset\n" },
    ]);
    const list = useUserCommands.getState().list;
    expect(list.map((c) => c.name)).toEqual(["toolbar2 (undo)", "toolbar10 (redo)"]);
    expect(list[0]!.steps).toBe("@board.undo");
    expect(notes).toHaveLength(2);
    expect(notes[1]).toContain("blockautoreset");
  });

  it("고치기 · 지우기", () => {
    const s = useUserCommands.getState();
    const id = s.add({ name: "a", steps: "", hotkey: null });
    s.update(id, { hotkey: "Ctrl+Alt+A" });
    expect(useUserCommands.getState().list[0]!.hotkey).toBe("Ctrl+Alt+A");
    useUserCommands.getState().remove(id);
    expect(useUserCommands.getState().list).toEqual([]);
  });

  it("모르는 앱 명령 · 꺼진 엔진이면 멈추고 까닭을 돌려준다", async () => {
    const base = { id: "x", name: "시험", hotkey: null };
    expect(await runUserCommand({ ...base, steps: "@nope.nope" })).toContain("@nope.nope");
    expect(await runUserCommand({ ...base, steps: "YXHASHCLEAR" })).toContain("YXHASHCLEAR");
  });

  it("앱 명령 id 는 겹치지 않고, Yixin 대응표의 id 는 모두 있다", () => {
    const ids = appCommands().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of Object.values(YIXIN_COMMANDS)) expect(findCommand(id), id).toBeDefined();
  });
});
