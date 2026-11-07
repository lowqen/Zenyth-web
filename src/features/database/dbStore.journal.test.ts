import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineCommand } from "../../engine/engine-types";
import type { FsResult } from "../../engine/engine-client";

/**
 * 저널(db6, A7) — 저장이 본 파일을 다시 옮기지 않고 저널만 Dexie 에 놓는지, 붙이기가 둘 다
 * 엔진에 돌려놓는지. 엔진 FS 는 흉내 낸다: 답(`next`)을 시험이 정한다.
 */
const fs = vi.hoisted(() => ({
  calls: [] as {
    op: string;
    path: string;
    size: number | undefined;
    knownBase: string | null | undefined;
  }[],
  next: null as FsResult | null,
}));

vi.mock("../../engine/engine-state", async (orig) => ({
  ...(await orig<typeof import("../../engine/engine-state")>()),
  engineFs: vi.fn(
    async (op: string, path: string, bytes?: Uint8Array, knownBase?: string | null) => {
      fs.calls.push({ op, path, size: bytes?.byteLength, knownBase });
      if (op === "write") return { ok: true, sig: `sig:${path}` };
      if (op === "save" || op === "compact") return fs.next ?? { ok: false };
      return { ok: true };
    },
  ),
}));

const { DB_FILE, JOURNAL_FILE, setDbPortForTest, useDbStore } = await import("./dbStore");
const { useEngineStore } = await import("../../engine/engine-state");
const { db } = await import("../../data/db");

const bytes = (n: number, v = 1) => new Uint8Array(n).fill(v);

function answeringPort() {
  let listener: ((l: string) => void) | null = null;
  return {
    send: (cmd: EngineCommand) => {
      if (cmd.kind === "dbPosition") setTimeout(() => listener?.("DATABASE ONE 0 0 0 0"), 0);
    },
    listen: (fn: (l: string) => void) => {
      listener = fn;
      return () => (listener = null);
    },
  };
}

const row = async (name: string) => (await db()!.dbfiles.get(name))?.bytes.byteLength ?? null;

beforeEach(async () => {
  await db()!.dbfiles.clear();
  fs.calls.length = 0;
  fs.next = null;
  setDbPortForTest(answeringPort());
  useEngineStore.setState({ status: "ready", analyzing: false, owner: null });
  useDbStore.setState({
    status: "off",
    busy: false,
    settings: { ...useDbStore.getState().settings, readonly: false },
  });
});

afterEach(() => {
  setDbPortForTest(null);
  useEngineStore.setState({ status: "idle" });
});

describe("저널(db6)", () => {
  it("붙이기는 본 파일 다음에 저널을 엔진에 놓는다 — 엔진이 본 파일을 열며 저널을 다시 읽는다", async () => {
    await db()!.dbfiles.bulkPut([
      { name: DB_FILE, bytes: bytes(1000), savedAt: 1 },
      { name: JOURNAL_FILE, bytes: bytes(80), savedAt: 2 },
    ]);

    expect(await useDbStore.getState().attach()).toBeNull();

    expect(fs.calls.map((c) => `${c.op} ${c.path} ${c.size ?? ""}`.trim())).toEqual([
      `write ${DB_FILE} 1000`,
      `write ${JOURNAL_FILE} 80`,
    ]);
    expect(useDbStore.getState().stored?.size).toBe(1080);
  });

  it("저널이 없으면 엔진 FS 의 묵은 저널을 지운다", async () => {
    await db()!.dbfiles.put({ name: DB_FILE, bytes: bytes(1000), savedAt: 1 });
    await useDbStore.getState().attach();
    expect(fs.calls.at(-1)).toMatchObject({ op: "remove", path: JOURNAL_FILE });
  });

  it("본 파일이 그대로면 저널만 놓는다 — 붙일 때 받은 정체를 knownBase 로 보낸다", async () => {
    await db()!.dbfiles.put({ name: DB_FILE, bytes: bytes(1000, 7), savedAt: 1 });
    await useDbStore.getState().attach();

    fs.next = { ok: true, sig: `sig:${DB_FILE}`, journal: bytes(120) };
    expect(await useDbStore.getState().save()).toBeNull();

    expect(fs.calls.at(-1)).toMatchObject({ op: "save", knownBase: `sig:${DB_FILE}` });
    expect(await row(DB_FILE)).toBe(1000);
    expect(await row(JOURNAL_FILE)).toBe(120);
    expect(useDbStore.getState().stored?.size).toBe(1120);
    expect(useDbStore.getState().log.at(-1)).toMatch(/저널 0\.1KB/);
  });

  it("본 파일이 바뀌면(접기 · 저널 끔) 본 파일을 갈고, 저널이 없으면 그 줄을 지운다", async () => {
    await db()!.dbfiles.bulkPut([
      { name: DB_FILE, bytes: bytes(1000), savedAt: 1 },
      { name: JOURNAL_FILE, bytes: bytes(80), savedAt: 2 },
    ]);
    await useDbStore.getState().attach();

    fs.next = { ok: true, sig: "sig:new", bytes: bytes(1500), journalGone: true };
    await useDbStore.getState().save();
    expect(await row(DB_FILE)).toBe(1500);
    expect(await row(JOURNAL_FILE)).toBeNull();

    // 다음 저장은 새 정체를 안다
    fs.next = { ok: true, sig: "sig:new", journal: bytes(40) };
    await useDbStore.getState().save();
    expect(fs.calls.at(-1)?.knownBase).toBe("sig:new");
  });

  it("본 파일도 정체도 없는 답은 저장으로 치지 않는다", async () => {
    await db()!.dbfiles.put({ name: DB_FILE, bytes: bytes(1000), savedAt: 1 });
    await useDbStore.getState().attach();
    fs.next = { ok: true, journal: bytes(40) };
    expect(await useDbStore.getState().save()).toMatch(/돌려주지 않았습니다/);
    expect(await row(JOURNAL_FILE)).toBeNull();
  });

  it("내보내기는 저널을 접은(compact) 본 파일을 내려준다", async () => {
    await db()!.dbfiles.bulkPut([
      { name: DB_FILE, bytes: bytes(1000), savedAt: 1 },
      { name: JOURNAL_FILE, bytes: bytes(80), savedAt: 2 },
    ]);
    await useDbStore.getState().attach();

    fs.next = { ok: true, sig: "sig:c", bytes: bytes(1040), journal: bytes(32) };
    const r = await useDbStore.getState().exportFile();

    expect(fs.calls.at(-1)?.op).toBe("compact");
    expect("bytes" in r && r.bytes.byteLength).toBe(1040);
  });

  it("떼어 둔 채 접히지 않은 저널이 있으면 반쪽 파일을 내려주지 않는다", async () => {
    await db()!.dbfiles.bulkPut([
      { name: DB_FILE, bytes: bytes(1000), savedAt: 1 },
      { name: JOURNAL_FILE, bytes: bytes(80), savedAt: 2 },
    ]);
    const r = await useDbStore.getState().exportFile();
    expect("error" in r && r.error).toMatch(/저널/);

    await db()!.dbfiles.put({ name: JOURNAL_FILE, bytes: bytes(32), savedAt: 3 });
    const r2 = await useDbStore.getState().exportFile();
    expect("bytes" in r2 && r2.bytes.byteLength).toBe(1000);
  });

  it("가져오기 · 지우기는 저널 줄도 치운다", async () => {
    await db()!.dbfiles.put({ name: JOURNAL_FILE, bytes: bytes(80), savedAt: 2 });
    useEngineStore.setState({ status: "idle" });
    useDbStore.setState({ settings: { ...useDbStore.getState().settings, enabled: false } });
    await useDbStore.getState().importFile(bytes(500));
    expect(await row(DB_FILE)).toBe(500);
    expect(await row(JOURNAL_FILE)).toBeNull();

    await db()!.dbfiles.put({ name: JOURNAL_FILE, bytes: bytes(80), savedAt: 2 });
    await useDbStore.getState().clearFile();
    expect(await row(DB_FILE)).toBeNull();
    expect(await row(JOURNAL_FILE)).toBeNull();
  });
});
