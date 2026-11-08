import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineCommand } from "../../engine/engine-types";

/**
 * 데스크톱 Z4 — 네이티브 · 원격 엔진의 DB 는 엔진 폴더(원격이면 서버)의 진짜 `rapfi.db` 다.
 * 붙이기 · 저장이 웹 저장소(Dexie) ↔ 메모리 FS 로 바이트를 옮기지 않고, 엔진이 제 파일을 열고 쓰게만 하는지,
 * 웹 저장소 파일 동작이 그 파일과 섞이지 않는지 본다.
 */
const fsOps = vi.hoisted(() => [] as string[]);

vi.mock("../../engine/engine-state", async (orig) => ({
  ...(await orig<typeof import("../../engine/engine-state")>()),
  engineFs: vi.fn(async (op: string) => {
    fsOps.push(op);
    if (op === "save" || op === "compact") return { ok: true, native: true };
    return { ok: false, error: "네이티브 엔진에는 메모리 FS 가 없다" };
  }),
}));

const { engineDbPath, setDbPortForTest, useDbStore } = await import("./dbStore");
const { useEngineStore } = await import("../../engine/engine-state");

/** 공식 Rapfi 0.43.01 의 말투(Z0 골든 `db-edit.jsonl`). */
function fakeNativeEngine() {
  const raw: string[] = [];
  const queries: string[] = [];
  let listener: ((l: string) => void) | null = null;
  const later = (lines: string[]) => setTimeout(() => lines.forEach((l) => listener?.(l)), 0);
  return {
    raw,
    queries,
    port: {
      send: (cmd: EngineCommand) => {
        if (cmd.kind === "raw") {
          raw.push(cmd.line);
          later([`Wrote (all) database to csv-format text file ${cmd.line.split("\n")[1]}`]);
        } else if (cmd.kind === "dbPosition") {
          queries.push(cmd.head);
          // `usedatabase 1` 뒤 첫 질의 앞에 엔진이 파일을 연다.
          if (queries.length === 1) later(["Opening yixin database at rapfi.db ..."]);
          later(["DATABASE ONE 0 0 0 0"]);
        }
      },
      listen: (fn: (l: string) => void) => {
        listener = fn;
        return () => (listener = null);
      },
    },
  };
}

let infos: string[] = [];

beforeEach(() => {
  infos = [];
  fsOps.length = 0;
  useEngineStore.setState({
    status: "ready",
    analyzing: false,
    owner: null,
    engine: { ...useEngineStore.getState().engine, variant: "native" },
    send: (...cmds: EngineCommand[]) => {
      for (const c of cmds) if (c.kind === "info") infos.push(`${c.key} ${c.value}`);
    },
  });
});

afterEach(() => {
  setDbPortForTest(null);
  useEngineStore.setState({ engine: { ...useEngineStore.getState().engine, variant: null } });
});

describe("엔진 폴더의 DB 붙이기", () => {
  it("메모리 FS 를 건드리지 않고 `usedatabase 1` 로 엔진이 제 파일을 열게 한다", async () => {
    const e = fakeNativeEngine();
    setDbPortForTest(e.port);

    expect(await useDbStore.getState().attach()).toBeNull();

    const s = useDbStore.getState();
    expect(s.status).toBe("on");
    expect(s.location).toBe("engine");
    expect(s.enginePath).toBe("rapfi.db");
    expect(infos).toEqual(["database_readonly 0", "usedatabase 1"]);
    expect(fsOps).toEqual([]);
  });

  it("저장은 엔진이 제 파일에 쓰게 할 뿐 웹 저장소에 바이트를 놓지 않는다", async () => {
    setDbPortForTest(fakeNativeEngine().port);
    await useDbStore.getState().attach();
    useDbStore.setState({ dirty: true });

    expect(await useDbStore.getState().save()).toBeNull();

    const s = useDbStore.getState();
    expect(fsOps).toEqual(["save"]);
    expect(s.dirty).toBe(false);
    expect(s.engineSavedAt).not.toBeNull();
    expect(s.stored).toBeNull();
    expect(s.log.at(-1)).toMatch(/rapfi\.db/);
  });

  it("웹 저장소 파일 동작(올리기 · 내려받기 · 지우기)은 거절한다 — 엔진 폴더의 파일과 섞이지 않게", async () => {
    setDbPortForTest(fakeNativeEngine().port);
    await useDbStore.getState().attach();

    expect(await useDbStore.getState().importFile(new Uint8Array([1, 2, 3]))).toMatch(
      /엔진 폴더의 DB/,
    );
    expect(await useDbStore.getState().clearFile()).toMatch(/엔진 폴더의 DB/);
    expect(await useDbStore.getState().exportFile()).toEqual({
      error: expect.stringMatching(/엔진 폴더의 DB/),
    });
    expect(useDbStore.getState().status).toBe("on");
    expect(fsOps).toEqual([]);
  });

  it("CSV 는 엔진 폴더에 날짜 붙은 이름으로 쓰게 하고 그 이름을 돌려준다", async () => {
    const e = fakeNativeEngine();
    setDbPortForTest(e.port);
    await useDbStore.getState().attach();

    const r = await useDbStore.getState().exportCsv();

    expect(e.raw).toHaveLength(1);
    expect(e.raw[0]).toMatch(/^yxdbtotxtall\nrapfi-\d{14}\.csv$/);
    expect(r).toEqual({ savedTo: e.raw[0]!.split("\n")[1] });
    expect(fsOps).toEqual([]);
  });
});

describe("engineDbPath", () => {
  it("엔진이 연 · 저장한 파일 경로를 읽는다", () => {
    expect(engineDbPath("Opening yixin database at rapfi.db ...")).toBe("rapfi.db");
    expect(engineDbPath("Opening yixin database at D:\\db\\my rapfi.db ...")).toBe(
      "D:\\db\\my rapfi.db",
    );
    expect(engineDbPath("DATABASE SAVE START rapfi.db")).toBe("rapfi.db");
    expect(engineDbPath("DATABASE SAVE DONE")).toBeNull();
    expect(engineDbPath("DATABASE REFRESH")).toBeNull();
  });
});
