/**
 * 엔진 로그의 «메시지» 보기 — 원시 콘솔 줄 가운데 엔진이 **사람에게** 한 말(`MESSAGE …`)만 골라 칸으로 나눈다.
 * 화면과 떨어진 순수 함수(2026-11-08 사용자 요청: 로그가 너무 많고 읽기 어렵다).
 *
 * `MESSAGE` 로 시작해도 앱이 해석하는 기계용 줄은 뺀다 — 실시간 오버레이(`REALTIME`), DB 답(`DATABASE`), 엔진
 * 능력(`INFO`), 오프닝 협상(`SWAP2` · `SOOSORV`). 이것들은 판 · 칩 · 대화 상자가 이미 그림으로 말하고, 탐색 한 번에
 * 수십 줄씩 쏟아져 사람이 읽을 줄을 밀어낸다. 원본은 «전체» 보기에 그대로 있다.
 *
 * Rapfi 의 사람용 줄은 ` | ` 로 칸을 나눈다:
 *   `MESSAGE Depth 2-4 | Eval 14 | Time 27ms | G10 G11 I9`          깊이마다
 *   `MESSAGE Speed 47417 | Depth 20-38 | Eval -155 | Node 937K | Time 19s`   탐색 끝
 *   `MESSAGE (1) 55 | 2-3 | E9 G11`                                 다중 PV 의 한 줄
 *   `MESSAGE OptiTime 8973ms | MaxTime 9970ms`                      시간 배분
 * 그 밖의 줄(`Load config from …` · `Saved database file …`)은 글 그대로다.
 */

const MACHINE = /^MESSAGE\s+(REALTIME|DATABASE|INFO|SWAP2|SOOSORV)\b/i;
const PREFIX = /^MESSAGE\s+/i;

/** 사람에게 보이는 메시지 줄인가. */
export function isHumanMessage(line: string): boolean {
  return PREFIX.test(line) && !MACHINE.test(line);
}

export type MessageKind = "search" | "final" | "pv" | "time" | "note";
export type FieldRole = "depth" | "eval" | "time" | "speed" | "node" | "pv" | "text";

export interface MessageField {
  readonly role: FieldRole;
  readonly value: string;
}

export interface ParsedMessage {
  readonly kind: MessageKind;
  /** 다중 PV 의 순위(1부터). */
  readonly rank: number | null;
  readonly fields: readonly MessageField[];
  /** `MESSAGE ` 를 뗀 본문 — 거르기 · 툴팁 · 복사용. */
  readonly text: string;
}

const KEYED: Readonly<Record<string, FieldRole>> = {
  depth: "depth",
  eval: "eval",
  time: "time",
  optitime: "time",
  maxtime: "time",
  speed: "speed",
  node: "node",
  nodes: "node",
};

const COORDS = /^[a-z]\d{1,2}(\s+[a-z]\d{1,2})*$/i;
const DEPTH = /^\d+(-\d+)?$/;
const RANK = /^\((\d+)\)\s+(\S+)$/;

function field(seg: string): MessageField {
  const keyed = /^([A-Za-z]+)\s+(.+)$/.exec(seg);
  const role = keyed ? KEYED[keyed[1]!.toLowerCase()] : undefined;
  if (keyed && role) return { role, value: keyed[2]!.trim() };
  if (COORDS.test(seg)) return { role: "pv", value: seg };
  if (DEPTH.test(seg)) return { role: "depth", value: seg };
  return { role: "text", value: seg };
}

export function parseMessage(line: string): ParsedMessage {
  const text = line.replace(PREFIX, "").trim();
  const segs = text
    .split(" | ")
    .map((s) => s.trim())
    .filter(Boolean);
  if (segs.length < 2 && !RANK.test(text)) {
    return { kind: "note", rank: null, fields: [{ role: "text", value: text }], text };
  }
  const rank = RANK.exec(segs[0] ?? "");
  if (rank) {
    const fields = [{ role: "eval", value: rank[2]! } as MessageField, ...segs.slice(1).map(field)];
    return { kind: "pv", rank: Number(rank[1]), fields, text };
  }
  const fields = segs.map(field);
  const head = (/^[A-Za-z]+/.exec(segs[0]!)?.[0] ?? "").toLowerCase();
  const kind: MessageKind =
    head === "speed"
      ? "final"
      : head === "depth"
        ? "search"
        : head === "optitime" || head === "maxtime"
          ? "time"
          : "note";
  return { kind, rank: null, fields, text };
}
