import { describe, expect, it } from "vitest";
import { isHumanMessage, parseMessage } from "./consoleMessages";

describe("엔진 로그 «메시지» 보기", () => {
  it("MESSAGE 줄만 — 앱이 해석하는 기계용 MESSAGE 와 보낸 줄 · 좌표 · INFO 블록은 뺀다", () => {
    const keep = [
      'MESSAGE Load config from "config.toml"',
      "MESSAGE Depth 2-4 | Eval 14 | Time 27ms | G10 G11 I9",
      "message Saved database file using 7 ms.",
    ];
    const drop = [
      "MESSAGE REALTIME POS 7,7",
      'MESSAGE DATABASE TEXT ""',
      "MESSAGE INFO MAX_THREAD_NUM 256",
      "MESSAGE SWAP2 SWAP",
      "MESSAGE SOOSORV MOVE5 2",
      "> yxnbest 3",
      "INFO PV 0 7,7",
      "7,7",
      "ERROR Failed to allocate 8388608 KB for transposition table.",
      "! 탐색 중에 보낸 명령: yxboard",
    ];
    expect(keep.filter(isHumanMessage)).toEqual(keep);
    expect(drop.filter(isHumanMessage)).toEqual([]);
  });

  it("깊이마다의 줄: 깊이 · 평가 · 시간 · 수순", () => {
    const m = parseMessage("MESSAGE Depth 2-4 | Eval 14 | Time 27ms | G10 G11 I9");
    expect(m.kind).toBe("search");
    expect(m.fields).toEqual([
      { role: "depth", value: "2-4" },
      { role: "eval", value: "14" },
      { role: "time", value: "27ms" },
      { role: "pv", value: "G10 G11 I9" },
    ]);
  });

  it("탐색 끝의 요약 줄", () => {
    const m = parseMessage("MESSAGE Speed 47417 | Depth 20-38 | Eval -155 | Node 937K | Time 19s");
    expect(m.kind).toBe("final");
    expect(m.fields.map((f) => f.role)).toEqual(["speed", "depth", "eval", "node", "time"]);
  });

  it("다중 PV 의 한 줄: 순위 · 평가 · 깊이 · 수순", () => {
    const m = parseMessage("MESSAGE (2) -29 | 2-4 | G7 I9 H9");
    expect(m.kind).toBe("pv");
    expect(m.rank).toBe(2);
    expect(m.fields).toEqual([
      { role: "eval", value: "-29" },
      { role: "depth", value: "2-4" },
      { role: "pv", value: "G7 I9 H9" },
    ]);
  });

  it("시간 배분 줄과 글 그대로의 줄", () => {
    expect(parseMessage("MESSAGE OptiTime 8973ms | MaxTime 9970ms").kind).toBe("time");
    const note = parseMessage('MESSAGE Load config from "config.toml"');
    expect(note.kind).toBe("note");
    expect(note.text).toBe('Load config from "config.toml"');
    expect(note.fields).toEqual([{ role: "text", value: 'Load config from "config.toml"' }]);
  });
});
