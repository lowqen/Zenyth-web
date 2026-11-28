import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../data/db";
import { fingerprintOf, MANIFEST_FILE, sameFingerprint } from "../../data/library";
import { bytes, fakeBridge, fakeFsaDir, text } from "./fakeFolders";
import { syncFolder } from "./folderSync";
import { FsaFolderSource } from "./fsaSource";
import {
  createEntry,
  getEntry,
  listEntries,
  listTrashed,
  purgeEntry,
  resetLibraryForTest,
  restoreEntry,
  trashEntry,
  updateEntry,
} from "./library";
import { placeNew } from "./libraryOps";
import { parseManifest } from "./source";
import { putSourceForTest, setFolderBridgeForTest } from "./sources";
import { joinPath, TauriFolderSource } from "./tauriSource";

/** 라이브러리 L4 — 웹 폴더(FSA) · 데스크톱 폴더(셸 다리) 소스와 폴더 항목의 수명(사이드카 · 휴지통). */

beforeEach(async () => {
  await db()!.dbfiles.clear();
  await db()!.libraryMeta.clear();
  await db()!.librarySources.clear();
  setFolderBridgeForTest(null);
  resetLibraryForTest();
});

const manifestOf = (dir: ReturnType<typeof fakeFsaDir>) =>
  parseManifest(text(dir.node.files.get(MANIFEST_FILE)?.data) ?? null);

describe("FsaFolderSource", () => {
  it("list 는 숨은 파일 · 사이드카 · 폴더를 빼고, writeAtomic 은 쓰고 null 은 지운다", async () => {
    const dir = fakeFsaDir();
    const src = new FsaFolderSource("f", dir);
    await src.writeAtomic([
      { name: "a.db", data: new Blob([bytes("base")]) },
      { name: "a.db.journal", data: new Blob([bytes("j")]) },
    ]);
    await src.writeManifest({ version: 1, entries: [] });
    await dir.getDirectoryHandle(".zenyth-trash", { create: true });
    await dir.getFileHandle(".hidden", { create: true });
    expect((await src.list()).map((f) => f.name).sort()).toEqual(["a.db", "a.db.journal"]);
    await src.writeAtomic([
      { name: "a.db.journal", data: null },
      { name: "none", data: null },
    ]);
    expect((await src.list()).map((f) => f.name)).toEqual(["a.db"]);
    expect(await (await src.open("a.db"))!.text()).toBe("base");
    expect(await src.open("x.db")).toBeNull();
    const f = await src.open("a.db");
    expect(sameFingerprint((await src.fingerprint("a.db"))!, await fingerprintOf(f!, 0))).toBe(
      true,
    );
  });

  it("rename 은 저널 · 백업과 함께 옮기고 덮어쓰지 않는다 — 대소문자만 다른 이름도 된다", async () => {
    const dir = fakeFsaDir();
    const src = new FsaFolderSource("f", dir);
    await src.writeAtomic([
      { name: "a.db", data: new Blob([bytes("A")]) },
      { name: "a.db.journal", data: new Blob([bytes("J")]) },
      { name: "a.db.bak1", data: new Blob([bytes("B")]) },
      { name: "taken.db", data: new Blob([bytes("T")]) },
    ]);
    await expect(src.rename("a.db", "taken.db")).rejects.toThrow(/exists/);
    await src.rename("a.db", "b.db");
    expect([...dir.node.files.keys()].sort()).toEqual([
      "b.db",
      "b.db.bak1",
      "b.db.journal",
      "taken.db",
    ]);
    await src.rename("b.db", "B.db");
    expect([...dir.node.files.keys()].sort()).toEqual([
      "B.db",
      "B.db.bak1",
      "B.db.journal",
      "taken.db",
    ]);
    expect(text(dir.node.files.get("B.db.journal")!.data)).toBe("J");
  });

  it("엔진 번호 백업(<줄기>_bak1.db)도 짝 — 이름 바꾸기 · 휴지통 · 되돌리기를 따라간다", async () => {
    const dir = fakeFsaDir();
    const src = new FsaFolderSource("f", dir);
    await src.writeAtomic([
      { name: "a.db", data: new Blob([bytes("A")]) },
      { name: "a_bak1.db", data: new Blob([bytes("B1")]) },
      { name: "A_BAK2.db", data: new Blob([bytes("B2")]) },
      { name: "ab_bak1.db", data: new Blob([bytes("X")]) },
    ]);
    await src.rename("a.db", "연구.db");
    expect([...dir.node.files.keys()].sort()).toEqual([
      "ab_bak1.db",
      "연구.db",
      "연구_BAK2.db",
      "연구_bak1.db",
    ]);
    const token = await src.trash("연구.db");
    const bin = dir.node.dirs.get(".zenyth-trash")!;
    expect([...bin.files.keys()].sort()).toEqual(
      [token, token.replace(/\.db$/, "_bak1.db"), token.replace(/\.db$/, "_BAK2.db")].sort(),
    );
    await src.restore(token, "연구.db");
    expect([...dir.node.files.keys()].sort()).toEqual([
      "ab_bak1.db",
      "연구.db",
      "연구_BAK2.db",
      "연구_bak1.db",
    ]);
    expect(text(dir.node.files.get("연구_bak1.db")!.data)).toBe("B1");
  });

  it("휴지통은 폴더 안 .zenyth-trash — 되돌리기 · 완전 삭제", async () => {
    const dir = fakeFsaDir();
    const src = new FsaFolderSource("f", dir);
    await src.writeAtomic([
      { name: "a.db", data: new Blob([bytes("A")]) },
      { name: "a.db.journal", data: new Blob([bytes("J")]) },
    ]);
    const token = await src.trash("a.db");
    expect(await src.list()).toEqual([]);
    const bin = dir.node.dirs.get(".zenyth-trash")!;
    expect([...bin.files.keys()].sort()).toEqual([token, `${token}.journal`]);
    await src.restore(token, "a.db");
    expect((await src.list()).map((f) => f.name).sort()).toEqual(["a.db", "a.db.journal"]);
    const t2 = await src.trash("a.db");
    await src.purge(t2);
    expect(bin.files.size).toBe(0);
  });
});

describe("TauriFolderSource", () => {
  const DIR = "C:\\연구";

  it("open 은 조각으로 읽어 Blob 을 잇고, fingerprint 는 끝 4KB 만 읽는다", async () => {
    const big = new Uint8Array(20_000).map((_, i) => i % 251);
    const files = new Map([["a.db", { data: big, mtime: 77 }]]);
    const { bridge, calls } = fakeBridge({ [DIR]: files });
    const src = new TauriFolderSource("t", DIR, async () => bridge);
    const blob = await src.open("a.db");
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(big);
    calls.length = 0;
    const fp = await src.fingerprint("a.db");
    expect(calls).toEqual([`read a.db ${20_000 - 4096} 4096`]);
    expect(fp).toEqual(await fingerprintOf(blob!, 77));
    expect(src.pathOf("a.db")).toBe("C:\\연구\\a.db");
    expect(joinPath("/home/me/db", "x.db")).toBe("/home/me/db/x.db");
  });

  it("쓰기 · 휴지통(OS) · 되돌리기 · 사이드카", async () => {
    const files = new Map<string, { data: Uint8Array; mtime: number }>();
    const { bridge, bin } = fakeBridge({ [DIR]: files });
    const src = new TauriFolderSource("t", DIR, async () => bridge);
    await src.writeAtomic([
      { name: "a.db", data: new Blob([bytes("hello")]) },
      { name: "a.db.journal", data: new Blob([bytes("j")]) },
    ]);
    expect(text(files.get("a.db")!.data)).toBe("hello");
    await src.writeAtomic([{ name: "a_bak1.db", data: new Blob([bytes("b")]) }]);
    expect(await src.trash("a.db")).toBe("a.db");
    expect(files.size).toBe(0);
    expect(bin.size).toBe(3);
    await src.restore("a.db", "a.db");
    expect([...files.keys()].sort()).toEqual(["a.db", "a.db.journal", "a_bak1.db"]);
    await src.writeManifest({ version: 1, entries: [] });
    expect((await src.readManifest()).entries).toEqual([]);
    expect(await src.access()).toBe("granted");
    expect(await new TauriFolderSource("x", "D:\\없음", async () => bridge).access()).toBe(
      "missing",
    );
  });
});

describe("폴더 항목의 수명", () => {
  async function folder() {
    const dir = fakeFsaDir("연구DB");
    const src = new FsaFolderSource("fold", dir);
    putSourceForTest(src);
    return { dir, src };
  }

  it("폴더를 맞추면 .db 파일이 «자동» 커버 항목이 되고, 사이드카가 생긴다", async () => {
    const { dir, src } = await folder();
    await src.writeAtomic([{ name: "화월.db", data: new Blob([bytes("x")]) }]);
    const rows = await syncFolder(src);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "화월", file: "화월.db", cover: { mode: "auto" } });
    expect(manifestOf(dir).entries.map((e) => e.id)).toEqual([rows[0]!.id]);
    expect((manifestOf(dir).entries[0] as { source?: string }).source).toBeUndefined();
  });

  it("고친 메타데이터(이름 · 커버)는 사이드카에 바로 적히고, Dexie 를 비워도 사이드카에서 돌아온다", async () => {
    const { dir, src } = await folder();
    await src.writeAtomic([{ name: "a.db", data: new Blob([bytes("x")]) }]);
    const [row] = await syncFolder(src);
    await updateEntry(row!.id, {
      title: "새 이름",
      cover: { mode: "opening", opening: 3, seed: 9 },
    });
    expect(manifestOf(dir).entries[0]).toMatchObject({ title: "새 이름", cover: { opening: 3 } });
    // 다른 기기 · 다시 설치 — Dexie 줄 없이 사이드카만 있다.
    await db()!.libraryMeta.clear();
    const again = await syncFolder(src);
    expect(again[0]).toMatchObject({ id: row!.id, title: "새 이름" });
  });

  it("새 DB 는 제목에서 파일 이름을 만든다 — 겹치면 (2), 쓸 수 없는 문자는 _", async () => {
    const { src } = await folder();
    await src.writeAtomic([{ name: "연구.db", data: new Blob([bytes("x")]) }]);
    await syncFolder(src);
    const a = await createEntry("연구", { select: false, source: "fold" });
    const b = await createEntry("a/b?", { select: false, source: "fold" });
    expect(a!.file).toBe("연구 (2).db");
    expect(b!.file).toBe("a_b_.db");
  });

  it("지우기는 폴더의 .zenyth-trash 로, 되돌리면 제자리, 그새 같은 이름이 생겼으면 (2) 로", async () => {
    const { dir, src } = await folder();
    await src.writeAtomic([{ name: "a.db", data: new Blob([bytes("x")]) }]);
    const [row] = await syncFolder(src);
    await trashEntry(row!.id);
    expect(await listEntries()).toEqual([]);
    expect((await listTrashed())[0]!.trashFile).toMatch(/-a\.db$/);
    await src.writeAtomic([{ name: "a.db", data: new Blob([bytes("other")]) }]);
    await restoreEntry(row!.id);
    const back = await getEntry(row!.id);
    expect(back!.file).toBe("a (2).db");
    expect(text(dir.node.files.get("a (2).db")!.data)).toBe("x");
    await trashEntry(row!.id);
    await purgeEntry(row!.id);
    expect(dir.node.dirs.get(".zenyth-trash")!.files.size).toBe(0);
    expect(manifestOf(dir).entries.some((e) => e.id === row!.id)).toBe(false);
  });

  it("병합 · 분리 결과는 고른 폴더에 파일로 놓인다(placeNew)", async () => {
    const { dir } = await folder();
    const e = await placeNew(
      "합친 DB",
      { mode: "eclipse", seed: 1 },
      new Blob([bytes("merged")]),
      "fold",
    );
    expect(e.file).toBe("합친 DB.db");
    expect(text(dir.node.files.get("합친 DB.db")!.data)).toBe("merged");
    expect(e.fingerprint!.size).toBe(6);
  });

  it("데스크톱 폴더도 같은 길 — 다리를 거쳐 사이드카 · 휴지통(OS)", async () => {
    const files = new Map<string, { data: Uint8Array; mtime: number }>();
    const { bridge, bin } = fakeBridge({ "C:\\db": files });
    setFolderBridgeForTest(bridge);
    const src = new TauriFolderSource("tau", "C:\\db", async () => bridge);
    putSourceForTest(src);
    files.set("x.db", { data: bytes("xx"), mtime: 3 });
    const [row] = await syncFolder(src);
    expect(files.has(MANIFEST_FILE)).toBe(true);
    await trashEntry(row!.id);
    expect(bin.has("C:\\db|x.db")).toBe(true);
    await restoreEntry(row!.id);
    expect(files.has("x.db")).toBe(true);
  });
});
