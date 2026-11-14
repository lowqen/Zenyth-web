import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { queryAll } from "../core/database/yixindb";
import type { Move } from "../core/model/move";
import { CoordMapper, serialize } from "./engine-protocol";

/**
 * 데스크톱 Z3 좌표 스모크 — **Zenyth 가 보내는 좌표 줄은 Yixin 이 같은 국면에 보낸 줄과 바이트까지 같다.**
 *
 * Yixin(main.c)은 칸 `idx` 를 `idx/size, idx%size`(행, 열)로 보낸다. Zenyth 의 `CoordMapper.toWire` 도 `"y,x"` 다
 * (데스크톱 경로는 뒤집지 않는다). 그러니 같은 엔진 · 같은 `config.toml` 에서 두 GUI 의 국면은 엔진에게 같고,
 * DB 기록도 같은 자리에 보인다. 여기서는 녹취의 `yxboard` · `yxquerydatabaseallt` 블록을 Zenyth 의 수로 읽어
 * Zenyth 의 직렬화기로 다시 쓰고, 원문과 같은지 본다. 머리 줄과 `done` 의 대소문자는 엔진이 가리지 않는다.
 *
 * 좌표 모드와 DB 의 관계(엔진 수준)는 2026-11-08 실측으로 따로 확인했다: yixindb 키는 대칭 정규형이라
 * `coord_conversion_mode` 를 바꿔도 같은 국면의 주석이 보이고, 자식 칸의 좌표는 질의한 틀을 따른다.
 */

const GOLDEN = join(__dirname, "../../tools/yixin-golden/golden");
const coord = new CoordMapper(15);

function guiLines(): string[] {
  return readdirSync(GOLDEN)
    .filter((f) => f.endsWith(".jsonl"))
    .flatMap((f) =>
      readFileSync(join(GOLDEN, f), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { dir: string; line?: string })
        .filter((r) => r.dir === "gui>eng" && typeof r.line === "string")
        .map((r) => r.line!),
    );
}

/** `head` 로 시작해 `done` 으로 끝나는 블록들(몸통 줄만). */
function blocks(lines: readonly string[], head: string): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.toLowerCase() !== head) continue;
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && lines[j]!.toLowerCase() !== "done") body.push(lines[j++]!);
    if (j < lines.length) out.push(body);
    i = j;
  }
  return out;
}

const lower = (ls: readonly string[]) => ls.map((l) => l.toLowerCase());

describe("골든 좌표 스모크 — Zenyth 직렬화 = Yixin 원문", () => {
  const lines = guiLines();

  it("yxboard 블록: 돌(행,열,편)을 Zenyth 수로 읽어 다시 쓰면 원문과 같다", () => {
    const bs = blocks(lines, "yxboard").filter((b) => b.length > 0);
    expect(bs.length).toBeGreaterThan(10);
    for (const body of bs) {
      const stones = body.map((l) => {
        const [r, c, s] = l.split(",").map(Number) as [number, number, number];
        return { move: coord.fromWire(r, c), own: s === 1 };
      });
      const again = serialize({ kind: "yxboard", stones }, coord);
      expect(lower(again)).toEqual(["yxboard", ...body, "done"]);
    }
  });

  it("DB 질의 블록: 수순을 Zenyth 수로 읽어 queryAll 로 다시 쓰면 원문과 같다", () => {
    const qs = blocks(lines, "yxquerydatabaseallt").filter((b) => b.length > 0);
    expect(qs.length).toBeGreaterThan(10);
    for (const body of qs) {
      const moves: Move[] = body.map((l) => coord.parsePair(l)!);
      expect(moves.every(Boolean)).toBe(true);
      expect(lower(serialize(queryAll(moves), coord))).toEqual([
        "yxquerydatabaseallt",
        ...body,
        "done",
      ]);
    }
  });

  it("같은 국면의 yxboard 돌 자리와 DB 질의 수순은 같은 틀이다", () => {
    // Yixin 은 국면이 바뀌면 판(yxboard)과 DB 질의를 잇달아 보낸다 — 두 블록의 칸 집합이 같아야 한다.
    let checked = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.toLowerCase() !== "yxboard") continue;
      const board: string[] = [];
      let j = i + 1;
      while (j < lines.length && lines[j]!.toLowerCase() !== "done") board.push(lines[j++]!);
      const q = lines.indexOf("yxquerydatabaseallt", j);
      if (q < 0 || q - j > 3) continue;
      const query: string[] = [];
      let k = q + 1;
      while (k < lines.length && lines[k]!.toLowerCase() !== "done") query.push(lines[k++]!);
      if (query.length !== board.length || board.length === 0) continue;
      const cells = (ls: string[]) => ls.map((l) => l.split(",").slice(0, 2).join(",")).sort();
      expect(cells(query)).toEqual(cells(board));
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
