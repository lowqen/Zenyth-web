import { describe, expect, it } from "vitest";
import {
  consoleFileName,
  filterConsole,
  HISTORY_MAX,
  parseConsoleInput,
  pushHistory,
} from "./consoleInput";

describe("엔진 콘솔 입력(데스크톱 Z4)", () => {
  it("줄 · `;` 마다 한 명령, 앞뒤 공백과 빈 조각은 버린다", () => {
    expect(parseConsoleInput("  YXHASHCLEAR  ")).toEqual(["YXHASHCLEAR"]);
    expect(parseConsoleInput("yxdbtotxtall\r\nout.csv\n\n")).toEqual(["yxdbtotxtall", "out.csv"]);
    expect(parseConsoleInput("INFO max_node 1000 ; YXNBEST 3;")).toEqual([
      "INFO max_node 1000",
      "YXNBEST 3",
    ]);
    expect(parseConsoleInput("   \n ; ")).toEqual([]);
  });

  it("기록은 바로 앞과 같으면 쌓지 않고, 상한을 넘으면 오래된 것부터 버린다", () => {
    expect(pushHistory(["A"], "A")).toEqual(["A"]);
    expect(pushHistory(["A"], "B")).toEqual(["A", "B"]);
    const many = Array.from({ length: HISTORY_MAX }, (_, i) => `C${i}`);
    const next = pushHistory(many, "NEW");
    expect(next).toHaveLength(HISTORY_MAX);
    expect(next[0]).toBe("C1");
    expect(next.at(-1)).toBe("NEW");
  });

  it("거르기 — 글자(대소문자 무시), `>` 보낸 줄, `<` 받은 줄", () => {
    const lines = [
      "> YXNBEST 3",
      "MESSAGE REALTIME BEST 7,7",
      "! 물러섭니다",
      "> INFO RULE 4",
      "OK",
    ];
    expect(filterConsole(lines, "")).toBe(lines);
    expect(filterConsole(lines, "rule")).toEqual(["> INFO RULE 4"]);
    expect(filterConsole(lines, ">")).toEqual(["> YXNBEST 3", "> INFO RULE 4"]);
    expect(filterConsole(lines, "> nbest")).toEqual(["> YXNBEST 3"]);
    expect(filterConsole(lines, "<")).toEqual(["MESSAGE REALTIME BEST 7,7", "OK"]);
  });

  it("저장 이름", () => {
    expect(consoleFileName(new Date(2026, 10, 8, 9, 5, 3))).toBe(
      "rapfi-console-20261108-090503.log",
    );
  });
});
