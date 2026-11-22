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
const { journalOf } = await import("../../data/library");
const { createEntry, resetLibraryForTest } = await import("../library/library");

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

/** 붙을 항목의 본 파일 · 저널 이름(Dexie 쪽). 엔진 쪽 이름은 늘 DB_FILE · JOURNAL_FILE. */
let BASE = "";
let JNL = "";
const row = async (name: string) => (await db()!.dbfiles.get(name))?.data.size ?? null;
const file = (name: string, n: number, savedAt: number, v = 1) => ({
  name,
  data: new Blob([bytes(n, v)]),
  savedAt,
});

beforeEach(async () => {
  await db()!.dbfiles.clear();
  await db()!.libraryMeta.clear();
  resetLibraryForTest();
  const e = (await createEntry("내 DB"))!;
  BASE = e.file;
  JNL = journalOf(e.file);
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
    await db()!.dbfiles.bulkPut([file(BASE, 1000, 1), file(JNL, 80, 2)]);

    expect(await useDbStore.getState().attach()).toBeNull();

    expect(fs.calls.map((c) => `${c.op} ${c.path} ${c.size ?? ""}`.trim())).toEqual([
      `write ${DB_FILE} 1000`,
      `write ${JOURNAL_FILE} 80`,
    ]);
    expect(useDbStore.getState().stored?.size).toBe(1080);
  });

  it("저널이 없으면 엔진 FS 의 묵은 저널을 지운다", async () => {
    await db()!.dbfiles.put(file(BASE, 1000, 1));
    await useDbStore.getState().attach();
    expect(fs.calls.at(-1)).toMatchObject({ op: "remove", path: JOURNAL_FILE });
  });

  it("본 파일이 그대로면 저널만 놓는다 — 붙일 때 받은 정체를 knownBase 로 보낸다", async () => {
    await db()!.dbfiles.put(file(BASE, 1000, 1, 7));
    await useDbStore.getState().attach();

    fs.next = { ok: true, sig: `sig:${DB_FILE}`, journal: bytes(120) };
    expect(await useDbStore.getState().save()).toBeNull();

    expect(fs.calls.at(-1)).toMatchObject({ op: "save", knownBase: `sig:${DB_FILE}` });
    expect(await row(BASE)).toBe(1000);
    expect(await row(JNL)).toBe(120);
    expect(useDbStore.getState().stored?.size).toBe(1120);
    expect(useDbStore.getState().log.at(-1)).toMatch(/저널 0\.1KB/);
  });

  it("본 파일이 바뀌면(접기 · 저널 끔) 본 파일을 갈고, 저널이 없으면 그 줄을 지운다", async () => {
    await db()!.dbfiles.bulkPut([file(BASE, 1000, 1), file(JNL, 80, 2)]);
    await useDbStore.getState().attach();

    fs.next = { ok: true, sig: "sig:new", bytes: bytes(1500), journalGone: true };
    await useDbStore.getState().save();
    expect(await row(BASE)).toBe(1500);
    expect(await row(JNL)).toBeNull();

    // 다음 저장은 새 정체를 안다
    fs.next = { ok: true, sig: "sig:new", journal: bytes(40) };
    await useDbStore.getState().save();
    expect(fs.calls.at(-1)?.knownBase).toBe("sig:new");
  });

  it("본 파일도 정체도 없는 답은 저장으로 치지 않는다", async () => {
    await db()!.dbfiles.put(file(BASE, 1000, 1));
    await useDbStore.getState().attach();
    fs.next = { ok: true, journal: bytes(40) };
    expect(await useDbStore.getState().save()).toMatch(/돌려주지 않았습니다/);
    expect(await row(JNL)).toBeNull();
  });

  it("내보내기는 저널을 접은(compact) 본 파일을 내려준다", async () => {
    await db()!.dbfiles.bulkPut([file(BASE, 1000, 1), file(JNL, 80, 2)]);
    await useDbStore.getState().attach();

    fs.next = { ok: true, sig: "sig:c", bytes: bytes(1040), journal: bytes(32) };
    const r = await useDbStore.getState().exportFile();

    expect(fs.calls.at(-1)?.op).toBe("compact");
    expect("file" in r && r.file.size).toBe(1040);
  });

  it("떼어 둔 채 접히지 않은 저널이 있으면 반쪽 파일을 내려주지 않는다", async () => {
    await db()!.dbfiles.bulkPut([file(BASE, 1000, 1), file(JNL, 80, 2)]);
    const r = await useDbStore.getState().exportFile();
    expect("error" in r && r.error).toMatch(/저널/);

    await db()!.dbfiles.put(file(JNL, 32, 3));
    const r2 = await useDbStore.getState().exportFile();
    expect("file" in r2 && r2.file.size).toBe(1000);
  });

  it("가져오기 · 지우기는 저널 줄도 치운다", async () => {
    await db()!.dbfiles.put(file(JNL, 80, 2));
    useEngineStore.setState({ status: "idle" });
    useDbStore.setState({ settings: { ...useDbStore.getState().settings, enabled: false } });
    await useDbStore.getState().importFile(bytes(500));
    expect(await row(BASE)).toBe(500);
    expect(await row(JNL)).toBeNull();

    await db()!.dbfiles.put(file(JNL, 80, 2));
    await useDbStore.getState().clearFile();
    expect(await row(BASE)).toBeNull();
    expect(await row(JNL)).toBeNull();
  });
});

describe("switchTo(id) — 라이브러리 L1", () => {
  const sends = () => fs.calls.map((c) => `${c.op} ${c.path} ${c.size ?? ""}`.trim());

  it("붙어 있으면 지금 것을 접어 저장하고(쉬는 파일 불변식) 고른 항목을 붙인다", async () => {
    await db()!.dbfiles.bulkPut([file(BASE, 1000, 1), file(JNL, 80, 2)]);
    const b = (await createEntry("B"))!;
    await db()!.dbfiles.put(file(b.file, 3000, 3));
    // createEntry 가 B 를 골랐다 — 처음 항목(A)으로 되돌려 붙인다(DB 설정이 꺼져 있어 고르기만 한다).
    const first = (await db()!.libraryMeta.toArray()).find((e) => e.file === BASE)!;
    expect(await useDbStore.getState().switchTo(first.id)).toBeNull();
    expect(useDbStore.getState().status).toBe("off");
    expect(await useDbStore.getState().attach()).toBeNull();
    expect(useDbStore.getState().active?.id).toBe(first.id);

    fs.calls.length = 0;
    fs.next = { ok: true, sig: "sig:folded", bytes: bytes(1050), journalGone: true };
    expect(await useDbStore.getState().switchTo(b.id)).toBeNull();

    expect(sends()).toEqual([
      `compact ${DB_FILE}`,
      `write ${DB_FILE} 3000`,
      `remove ${JOURNAL_FILE}`,
    ]);
    // 뗀 A 는 저널이 접힌 한 벌
    expect(await row(BASE)).toBe(1050);
    expect(await row(JNL)).toBeNull();
    const aRow = await db()!.libraryMeta.get(first.id);
    expect(aRow?.fingerprint?.size).toBe(1050);
    expect(useDbStore.getState()).toMatchObject({
      status: "on",
      active: { id: b.id, title: "B" },
      stored: { size: 3000 },
    });

    // 다음 저장은 B 의 파일에 간다
    fs.next = { ok: true, sig: "sig:b2", bytes: bytes(3100) };
    await useDbStore.getState().save();
    expect(await row(b.file)).toBe(3100);
    expect(await row(BASE)).toBe(1050);
  });

  it("저장이 실패하면 바꾸지 않는다", async () => {
    await db()!.dbfiles.put(file(BASE, 1000, 1));
    const first = (await db()!.libraryMeta.toArray())[0]!;
    await useDbStore.getState().attach();
    const b = (await createEntry("B"))!;
    // createEntry 가 고른 것을 붙은 항목으로 되돌린다(화면 밖에서 만든 항목)
    await useDbStore.getState().switchTo(first.id);

    fs.next = { ok: false, error: "디스크 가득" };
    expect(await useDbStore.getState().switchTo(b.id)).toBe("디스크 가득");
    expect(useDbStore.getState()).toMatchObject({ status: "on", active: { id: first.id } });
    fs.next = { ok: true, sig: "sig:x", journal: bytes(40) };
    await useDbStore.getState().save();
    expect(await row(JNL)).toBe(40);
    expect(await row(journalOf(b.file))).toBeNull();
  });

  it("엔진이 없으면 고르기만 — 붙이지 않는다", async () => {
    useEngineStore.setState({ status: "idle" });
    const b = (await createEntry("B"))!;
    await db()!.dbfiles.put(file(b.file, 700, 9));
    const first = (await db()!.libraryMeta.toArray()).find((e) => e.file === BASE)!;
    expect(await useDbStore.getState().switchTo(first.id)).toBeNull();
    expect(await useDbStore.getState().switchTo(b.id)).toBeNull();
    expect(fs.calls).toEqual([]);
    expect(useDbStore.getState()).toMatchObject({
      status: "off",
      active: { id: b.id },
      stored: { size: 700 },
    });
    expect(await useDbStore.getState().switchTo("nope")).toMatch(/없는/);
  });

  it("엔진 폴더의 DB(데스크톱 Z4)를 쓰는 중이면 받지 않는다", async () => {
    const b = (await createEntry("B"))!;
    useDbStore.setState({ status: "on", location: "engine" });
    expect(await useDbStore.getState().switchTo(b.id)).toMatch(/엔진 폴더/);
    useDbStore.setState({ status: "off", location: "browser" });
  });
});
