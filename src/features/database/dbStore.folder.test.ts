import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineCommand } from "../../engine/engine-types";

/**
 * 라이브러리 L4 — 데스크톱 네이티브 엔진은 폴더 소스의 DB 를 `YXSETDATABASE <절대 경로>` 로 직접 연다(복사 없음).
 * 바꿔 붙이기 = 접어 저장 → `usedatabase 0` → 새 경로. 폴더가 아닌 DB 로는 바꾸지 않는다. 저장 뒤 정체를 다시 잰다.
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

const { setDbPortForTest, useDbStore } = await import("./dbStore");
const { useEngineStore } = await import("../../engine/engine-state");
const { db } = await import("../../data/db");
const { newEntry } = await import("../../data/library");
const { writeActiveId, getEntry, createEntry } = await import("../library/library");
const { setFolderBridgeForTest, loadSources } = await import("../library/sources");
const { fakeBridge, bytes } = await import("../library/fakeFolders");

const DIR = "C:\\Users\\me\\연구DB";
let raw: string[] = [];
let infos: string[] = [];

function port() {
  let listener: ((l: string) => void) | null = null;
  const later = (lines: string[]) => setTimeout(() => lines.forEach((l) => listener?.(l)), 0);
  return {
    send: (cmd: EngineCommand) => {
      if (cmd.kind === "raw") raw.push(cmd.line);
      else if (cmd.kind === "dbPosition") later(["DATABASE ONE 0 0 0 0"]);
    },
    listen: (fn: (l: string) => void) => {
      listener = fn;
      return () => (listener = null);
    },
  };
}

let files: Map<string, { data: Uint8Array; mtime: number }>;

beforeEach(async () => {
  raw = [];
  infos = [];
  fsOps.length = 0;
  await db()!.libraryMeta.clear();
  await db()!.librarySources.clear();
  files = new Map([
    ["a.db", { data: bytes("aaaa"), mtime: 10 }],
    ["b.db", { data: bytes("bb"), mtime: 20 }],
  ]);
  setFolderBridgeForTest(fakeBridge({ [DIR]: files }).bridge);
  await db()!.librarySources.put({
    id: "tau",
    kind: "tauri",
    path: DIR,
    label: "연구DB",
    addedAt: 1,
  });
  await loadSources();
  for (const [id, file] of [
    ["A", "a.db"],
    ["B", "b.db"],
  ] as const) {
    const e = newEntry("tau", id, { file });
    e.id = id;
    await db()!.libraryMeta.put(e);
  }
  writeActiveId("A");
  useEngineStore.setState({
    status: "ready",
    analyzing: false,
    owner: null,
    engine: { ...useEngineStore.getState().engine, variant: "native" },
    send: (...cmds: EngineCommand[]) => {
      for (const c of cmds) {
        if (c.kind === "info") infos.push(`${c.key} ${c.value}`);
        else if (c.kind === "raw") raw.push(c.line);
      }
    },
  });
  setDbPortForTest(port());
});

afterEach(() => {
  setDbPortForTest(null);
  setFolderBridgeForTest(null);
  useEngineStore.setState({ engine: { ...useEngineStore.getState().engine, variant: null } });
});

describe("데스크톱 폴더의 DB — 네이티브 엔진", () => {
  it("붙이기는 YXSETDATABASE <절대 경로> — usedatabase 1 도 메모리 FS 도 쓰지 않는다", async () => {
    expect(await useDbStore.getState().attach()).toBeNull();
    const s = useDbStore.getState();
    expect(s.status).toBe("on");
    expect(s.location).toBe("engine");
    expect(s.active).toEqual({ id: "A", title: "A" });
    expect(raw).toEqual([`YXSETDATABASE ${DIR}\\a.db`]);
    // 옛 저장소(엔진 설정이 미리 연 DB)를 먼저 놓는다 — 두 DB 가 한꺼번에 메모리에 들지 않게
    expect(infos).toEqual(["usedatabase 0", "database_readonly 0"]);
    expect(fsOps).toEqual([]);
    expect(s.stored?.size).toBe(4);
  });

  it("바꿔 붙이기 = 접어 저장 → usedatabase 0 → 새 경로", async () => {
    await useDbStore.getState().attach();
    raw = [];
    infos = [];
    expect(await useDbStore.getState().switchTo("B")).toBeNull();
    expect(fsOps).toEqual(["compact"]);
    expect(infos).toEqual(["usedatabase 0", "usedatabase 0", "database_readonly 0"]);
    expect(raw).toEqual([`YXSETDATABASE ${DIR}\\b.db`]);
    expect(useDbStore.getState().active?.id).toBe("B");
  });

  it("폴더가 아닌(브라우저) DB 로는 바꾸지 않는다", async () => {
    await useDbStore.getState().attach();
    const web = (await createEntry("웹 DB", { select: false }))!;
    expect(await useDbStore.getState().switchTo(web.id)).toMatch(/폴더의 DB 만/);
    expect(useDbStore.getState().active?.id).toBe("A");
  });

  it("엔진이 파일에 저장하면 정체를 다시 잰다(본 파일이 바뀌면 통계를 버린다)", async () => {
    await useDbStore.getState().attach();
    files.set("a.db", { data: bytes("aaaaaaaa"), mtime: 99 });
    useDbStore.setState({ dirty: true });
    expect(await useDbStore.getState().save()).toBeNull();
    const e = await getEntry("A");
    expect(e!.fingerprint).toMatchObject({ size: 8, mtime: 99 });
    expect(useDbStore.getState().stored?.size).toBe(8);
  });

  it("release 는 접어 저장하고 뗀다 — 이름 바꾸기 뒤 attach 가 새 이름으로 다시 연다", async () => {
    await useDbStore.getState().attach();
    infos = [];
    raw = [];
    expect(await useDbStore.getState().release()).toBeNull();
    expect(fsOps).toEqual(["compact"]);
    expect(infos).toEqual(["usedatabase 0"]);
    expect(useDbStore.getState().status).toBe("off");
    await db()!.libraryMeta.update("A", { file: "화월.db" });
    files.set("화월.db", files.get("a.db")!);
    files.delete("a.db");
    expect(await useDbStore.getState().attach()).toBeNull();
    expect(raw).toEqual([`YXSETDATABASE ${DIR}\\화월.db`]);
  });

  it("원격 엔진은 폴더 경로를 쓰지 않는다 — 엔진 설정의 DB(usedatabase 1)", async () => {
    useEngineStore.setState({ engine: { ...useEngineStore.getState().engine, variant: "remote" } });
    expect(await useDbStore.getState().attach()).toBeNull();
    expect(raw).toEqual([]);
    expect(infos).toEqual(["database_readonly 0", "usedatabase 1"]);
  });
});
