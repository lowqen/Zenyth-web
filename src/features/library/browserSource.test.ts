import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../data/db";
import { journalOf, newBrowserEntry } from "../../data/library";
import { BrowserSource } from "./browserSource";
import {
  createEntry,
  ensureActive,
  getEntry,
  listEntries,
  readActiveId,
  recordSaved,
  resetLibraryForTest,
  resolveActive,
  selectEntry,
  updateEntry,
} from "./library";

const src = new BrowserSource();
const blob = (n: number) => new Blob([new Uint8Array(n).fill(1)]);
const size = async (name: string) => (await src.open(name))?.size ?? null;

beforeEach(async () => {
  await db()!.dbfiles.clear();
  await db()!.libraryMeta.clear();
  resetLibraryForTest();
});

describe("BrowserSource", () => {
  it("writeAtomic — 본 파일과 저널을 함께 놓고, null 은 지운다", async () => {
    await src.writeAtomic(
      [
        { name: "lib/a", data: blob(100) },
        { name: "lib/a.journal", data: blob(40) },
      ],
      7,
    );
    expect(await src.list()).toEqual([
      { name: "lib/a", size: 100, mtime: 7 },
      { name: "lib/a.journal", size: 40, mtime: 7 },
    ]);
    await src.writeAtomic([{ name: "lib/a.journal", data: null }]);
    expect(await size("lib/a.journal")).toBeNull();
    expect(await src.mtime("lib/a")).toBe(7);
  });

  it("rename — 저널도 따라가고, 덮어쓰지 않는다", async () => {
    await src.writeAtomic([
      { name: "lib/a", data: blob(100) },
      { name: "lib/a.journal", data: blob(40) },
      { name: "lib/b", data: blob(5) },
    ]);
    await expect(src.rename("lib/a", "lib/b")).rejects.toThrow(/exists/);
    expect(await size("lib/a")).toBe(100);
    await src.rename("lib/a", "lib/c");
    expect(await size("lib/a")).toBeNull();
    expect(await size("lib/c")).toBe(100);
    expect(await size(journalOf("lib/c"))).toBe(40);
    await expect(src.rename("lib/zzz", "lib/y")).rejects.toThrow(/missing/);
  });

  it("휴지통 — 목록에서 빠지고, 되돌리고, 30일 지난 것만 아주 지운다", async () => {
    await src.writeAtomic([
      { name: "lib/a", data: blob(100) },
      { name: "lib/a.journal", data: blob(40) },
      { name: "lib/b", data: blob(5) },
    ]);
    await src.trash("lib/a");
    expect((await src.list()).map((f) => f.name)).toEqual(["lib/b"]);
    await src.restore("lib/a");
    expect(await size("lib/a.journal")).toBe(40);

    await src.trash("lib/a");
    await src.trash("lib/b");
    expect(await src.purgeTrash(0)).toBe(0); // 아직 아무것도 오래되지 않았다
    expect(await src.purgeTrash(Date.now() + 1)).toBe(3);
    expect(await db()!.dbfiles.count()).toBe(0);
  });

  it("매니페스트 — 브라우저 소스 줄만 읽고 갈아 쓴다", async () => {
    const a = newBrowserEntry("A", 1);
    const other = { ...newBrowserEntry("F", 1), source: "folder-x" };
    await db()!.libraryMeta.bulkPut([a, other]);
    const m = await src.readManifest();
    expect(m.entries.map((e) => e.title)).toEqual(["A"]);
    expect(m.entries[0]).not.toHaveProperty("source");

    const b = newBrowserEntry("B", 2);
    await src.writeManifest({ version: 1, entries: [b] });
    expect((await src.readManifest()).entries.map((e) => e.id)).toEqual([b.id]);
    expect(await db()!.libraryMeta.get(other.id)).toBeTruthy();
  });
});

describe("항목 고르기", () => {
  it("항목이 없으면 null, ensureActive 는 «내 DB» 를 만들어 고른다", async () => {
    expect(await resolveActive()).toBeNull();
    const e = await ensureActive();
    expect(e?.title).toBe("내 DB");
    expect(readActiveId()).toBe(e!.id);
    expect((await ensureActive())!.id).toBe(e!.id);
  });

  it("고른 항목이 사라지면(휴지통) 마지막에 연 항목으로 물러선다", async () => {
    const a = (await createEntry("A"))!;
    const b = (await createEntry("B"))!;
    await updateEntry(a.id, { lastOpenedAt: Date.now() + 10 });
    expect(readActiveId()).toBe(b.id);
    expect((await resolveActive())!.id).toBe(b.id);
    await updateEntry(b.id, { trashedAt: Date.now() });
    expect(await getEntry(b.id)).toBeNull();
    expect((await resolveActive())!.id).toBe(a.id);
    expect(readActiveId()).toBe(a.id);
    expect((await listEntries()).map((e) => e.title)).toEqual(["A"]);
  });

  it("selectEntry 는 연 시각을 적고, 없는 항목은 고르지 않는다", async () => {
    const a = (await createEntry("A"))!;
    const b = (await createEntry("B"))!;
    expect(await selectEntry("nope")).toBe(false);
    expect(readActiveId()).toBe(b.id);
    expect(await selectEntry(a.id)).toBe(true);
    expect(readActiveId()).toBe(a.id);
    expect((await listEntries())[0]!.id).toBe(a.id);
  });

  it("recordSaved — 본 파일이 바뀌면 정체를 갈고 통계를 버린다. 저널만이면 그대로", async () => {
    const a = (await createEntry("A"))!;
    const fp = { size: 10, mtime: 1, tail: "00" };
    const stats = { records: 1, rules: {}, labels: { W: 0, L: 0, D: 0, other: 0 }, commented: 0 };
    await updateEntry(a.id, { fingerprint: fp, stats });

    await recordSaved(a.id, 50);
    expect(await getEntry(a.id)).toMatchObject({ updatedAt: 50, fingerprint: fp, stats });

    const fp2 = { size: 20, mtime: 60, tail: "11" };
    await recordSaved(a.id, 60, fp2);
    const e = await getEntry(a.id);
    expect(e).toMatchObject({ updatedAt: 60, fingerprint: fp2 });
    expect(e).not.toHaveProperty("stats");

    await recordSaved(a.id, 70, null);
    expect(await getEntry(a.id)).not.toHaveProperty("fingerprint");
  });
});
