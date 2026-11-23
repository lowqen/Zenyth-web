import { describe, expect, it } from "vitest";
import type { Fingerprint, LibraryEntry } from "../../data/library";
import type { DbStats } from "../../core/database/yxdbindex";
import { MISSING_DAYS, reconcile } from "./folderSync";
import type { LibraryFileInfo } from "./source";

/** 라이브러리 L4 — 사이드카 항목 ↔ 폴더의 파일 맞추기(`reconcile`, 순수). */

const NOW = 1_800_000_000_000;
const fp = (size: number, tail: string, mtime = 1): Fingerprint => ({ size, mtime, tail });
const file = (name: string, size: number, mtime = 1): LibraryFileInfo => ({ name, size, mtime });
const stats = { records: 3 } as DbStats;

function entry(id: string, file: string, extra: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    id,
    file,
    title: id,
    cover: { mode: "eclipse", seed: 1 },
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

/** 파일 이름 → 정체(끝 해시는 이름에서 정하되 `tails` 로 바꿀 수 있다). */
function fpOf(files: LibraryFileInfo[], tails: Record<string, string> = {}) {
  const asked: string[] = [];
  return {
    asked,
    fingerprint: async (name: string) => {
      asked.push(name);
      const f = files.find((x) => x.name === name);
      return f ? fp(f.size, tails[name] ?? `t-${f.size}`, f.mtime) : null;
    },
  };
}

const run = (entries: LibraryEntry[], files: LibraryFileInfo[], extra = {}) => {
  const f = fpOf(files, (extra as { tails?: Record<string, string> }).tails);
  return reconcile({
    sourceId: "fold",
    entries,
    files,
    fingerprint: f.fingerprint,
    takenIds: new Set((extra as { taken?: string[] }).taken ?? []),
    now: NOW,
  }).then((r) => ({ ...r, asked: f.asked }));
};

describe("reconcile", () => {
  it("파일이 그대로면 정체를 다시 재지 않고 바꾼 것도 없다", async () => {
    const r = await run(
      [entry("a", "a.db", { fingerprint: fp(10, "t-10", 5), stats })],
      [file("a.db", 10, 5), file("a.db.journal", 32)],
    );
    expect(r.changed).toBe(false);
    expect(r.asked).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ id: "a", source: "fold", stats });
  });

  it("다른 프로그램이 파일을 바꿨으면 정체를 갈고 통계를 버린다", async () => {
    const r = await run(
      [entry("a", "a.db", { fingerprint: fp(10, "t-10", 5), stats })],
      [file("a.db", 12, 9)],
    );
    expect(r.changed).toBe(true);
    expect(r.rows[0]!.fingerprint).toEqual(fp(12, "t-12", 9));
    expect(r.rows[0]!.stats).toBeUndefined();
  });

  it("바꾼 시각만 달라졌으면(복사) 통계는 남기고 시각만 맞춘다", async () => {
    const r = await run(
      [entry("a", "a.db", { fingerprint: fp(10, "t-10", 5), stats })],
      [file("a.db", 10, 7)],
    );
    expect(r.rows[0]!.stats).toBe(stats);
    expect(r.rows[0]!.fingerprint!.mtime).toBe(7);
  });

  it("앱 밖에서 이름을 바꾼 파일을 정체로 다시 짝짓는다", async () => {
    const r = await run(
      [entry("a", "old.db", { fingerprint: fp(10, "t-10"), title: "화월", stats })],
      [file("new.db", 10)],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ id: "a", file: "new.db", title: "화월", stats });
    expect(r.rows[0]!.missingSince).toBeUndefined();
  });

  it("크기가 같아도 끝 해시가 다르면 짝짓지 않는다 — 사라진 항목 + 새 항목", async () => {
    const r = await run(
      [entry("a", "old.db", { fingerprint: fp(10, "zzz") })],
      [file("new.db", 10)],
    );
    expect(r.rows).toHaveLength(2);
    expect(r.rows.find((x) => x.id === "a")!.missingSince).toBe(NOW);
    expect(r.rows.find((x) => x.id !== "a")).toMatchObject({ file: "new.db", title: "new" });
  });

  it("사라진 지 30일이 지나면 버린다", async () => {
    const old = NOW - (MISSING_DAYS + 1) * 86_400_000;
    const r = await run(
      [entry("a", "gone.db", { fingerprint: fp(1, "x"), missingSince: old })],
      [],
    );
    expect(r.rows).toEqual([]);
    expect(r.changed).toBe(true);
  });

  it("파일 없이 만든 새 DB(정체 없음)는 사라진 것으로 보지 않는다", async () => {
    const r = await run([entry("a", "새 DB.db")], []);
    expect(r.rows[0]!.missingSince).toBeUndefined();
    expect(r.changed).toBe(false);
  });

  it("새 .db 파일은 «자동» 커버의 새 항목 — 저널 · 숨은 파일 · 다른 확장자는 아니다", async () => {
    const r = await run(
      [],
      [
        file("연구.db", 7),
        file("연구.db.journal", 32),
        file(".hidden.db", 1),
        file("notes.txt", 2),
      ],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      file: "연구.db",
      title: "연구",
      source: "fold",
      cover: { mode: "auto" },
      fingerprint: fp(7, "t-7", 1),
    });
  });

  it("대소문자만 바뀐 파일 이름을 따라간다", async () => {
    const r = await run(
      [entry("a", "a.db", { fingerprint: fp(10, "t-10", 1) })],
      [file("A.db", 10)],
    );
    expect(r.rows[0]!.file).toBe("A.db");
    expect(r.changed).toBe(true);
  });

  it("다른 소스가 쓰는 id(폴더를 통째로 복사)와 같은 사이드카 안의 겹친 id 는 새 id 로", async () => {
    const r = await run(
      [
        entry("dup", "a.db", { fingerprint: fp(1, "t-1") }),
        entry("x", "b.db", { fingerprint: fp(2, "t-2") }),
        entry("x", "c.db"),
      ],
      [file("a.db", 1), file("b.db", 2)],
      { taken: ["dup"] },
    );
    const ids = r.rows.map((x) => x.id);
    expect(ids).not.toContain("dup");
    expect(new Set(ids).size).toBe(3);
    expect(r.changed).toBe(true);
  });

  it("휴지통의 항목은 파일이 없어도 그대로 둔다", async () => {
    const r = await run([entry("a", "a.db", { trashedAt: 5, trashFile: "5-a.db" })], []);
    expect(r.rows[0]).toMatchObject({ id: "a", trashedAt: 5 });
    expect(r.rows[0]!.missingSince).toBeUndefined();
  });
});
