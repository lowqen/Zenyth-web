import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { RapfiDb } from "./db";
import {
  BROWSER_SOURCE_ID,
  fingerprintBytes,
  fingerprintOf,
  fnv1a64,
  journalOf,
  newEntryId,
  sameFingerprint,
} from "./library";

/** v5 까지의 모양으로 DB 를 만들고 옛 `rapfi.db`(+ 저널) 줄을 넣는다 — 이관 전 사용자의 브라우저. */
async function legacyV5(
  name: string,
  rows: { name: string; bytes: Uint8Array; savedAt: number }[],
) {
  const old = new Dexie(name);
  old.version(5).stores({
    games: "++id, name, savedAt, &slot",
    reviews: "++id, createdAt",
    queue: "++id, order, status",
    dbfiles: "&name",
    joseki: "id, title, category, updatedAt",
    josekiIndex: "++id, key, josekiId",
    packs: "&name",
  });
  await old.table("dbfiles").bulkPut(rows);
  await old.table("games").put({ name: "x", size: 15, moves: [], future: [], savedAt: 1 });
  old.close();
}

const filled = (n: number, seed: number) =>
  Uint8Array.from({ length: n }, (_, i) => (i * seed) & 255);

describe("정체(fingerprint)", () => {
  it("FNV-1a 64 — db6 `fnv1a` 와 같은 값(표준 시험 벡터)", () => {
    expect(fnv1a64(new Uint8Array())).toBe("cbf29ce484222325");
    expect(fnv1a64(new TextEncoder().encode("a"))).toBe("af63dc4c8601ec8c");
    expect(fnv1a64(new TextEncoder().encode("foobar"))).toBe("85944171f73967e8");
  });

  it("끝 4KB 만 본다 — Blob 과 바이트가 같은 답, 앞부분이 달라도 같은 정체", async () => {
    const a = filled(10_000, 7);
    const b = a.slice();
    b[0] = 99;
    const fa = fingerprintBytes(a, 1);
    expect(await fingerprintOf(new Blob([a]), 1)).toEqual(fa);
    expect(sameFingerprint(fa, fingerprintBytes(b, 2))).toBe(true);
    b[9_999] = b[9_999]! ^ 1;
    expect(sameFingerprint(fa, fingerprintBytes(b, 2))).toBe(false);
  });

  it("UUID v4 모양", () => {
    expect(newEntryId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("v6 이관", () => {
  it("옛 rapfi.db 와 저널이 lib/<id> Blob 짝으로 옮겨져 첫 항목 «내 DB» 가 된다", async () => {
    const base = filled(6000, 3);
    const jnl = filled(80, 5);
    await legacyV5("mig-a", [
      { name: "rapfi.db", bytes: base, savedAt: 1000 },
      { name: "rapfi.db.journal", bytes: jnl, savedAt: 2000 },
    ]);

    const d = new RapfiDb("mig-a");
    const entries = await d.libraryMeta.toArray();
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e).toMatchObject({
      source: BROWSER_SOURCE_ID,
      file: `lib/${e.id}`,
      title: "내 DB",
      createdAt: 1000,
      updatedAt: 1000,
      cover: { mode: "eclipse" },
    });
    expect(e.fingerprint).toEqual(fingerprintBytes(base, 1000));

    const names = (await d.dbfiles.toArray()).map((r) => r.name).sort();
    expect(names).toEqual([e.file, journalOf(e.file)].sort());
    const moved = await d.dbfiles.get(e.file);
    expect(moved!.data).toBeInstanceOf(Blob);
    expect(new Uint8Array(await moved!.data.arrayBuffer())).toEqual(base);
    expect(moved!.savedAt).toBe(1000);
    const mj = await d.dbfiles.get(journalOf(e.file));
    expect(new Uint8Array(await mj!.data.arrayBuffer())).toEqual(jnl);
    expect(mj!.savedAt).toBe(2000);

    expect(await d.librarySources.get(BROWSER_SOURCE_ID)).toMatchObject({ kind: "browser" });
    // 다른 표는 그대로
    expect(await d.games.count()).toBe(1);
    d.close();
  });

  it("옛 파일이 없으면 소스 줄만 — 본 파일 없는 저널은 버린다", async () => {
    await legacyV5("mig-b", [{ name: "rapfi.db.journal", bytes: filled(40, 1), savedAt: 5 }]);
    const d = new RapfiDb("mig-b");
    expect(await d.libraryMeta.count()).toBe(0);
    expect(await d.dbfiles.count()).toBe(0);
    expect(await d.librarySources.count()).toBe(1);
    d.close();
  });

  it("새로 만드는 DB 도 v6 표를 갖는다", async () => {
    const d = new RapfiDb("mig-fresh");
    await d.open();
    expect(d.verno).toBe(6);
    expect(await d.libraryMeta.count()).toBe(0);
    d.close();
  });
});
