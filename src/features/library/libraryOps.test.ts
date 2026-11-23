import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  compareYxdbKeys,
  metaRecord,
  YxdbCancelled,
  YxdbWriter,
} from "../../core/database/yxdbfile";
import { keyOfMoves } from "../../core/database/yxdbkey";
import { countYxdb } from "../../core/database/yxdbmerge";
import { representative } from "../../core/opening/opening26";
import { move, type Move } from "../../core/model/move";
import { db } from "../../data/db";
import { journalOf, type LibraryCover } from "../../data/library";
import { browserSource } from "./browserSource";
import { createEntry, getEntry, listEntries, listTrashed, resetLibraryForTest } from "./library";
import { runJob } from "./libraryJobs";
import type { LibraryJob } from "./protocol";
import type { JobProgress } from "../../core/database/yxdbmerge";
import {
  commitMerge,
  commitSplit,
  previewMerge,
  previewSplit,
  type JobRunner,
  type OpsEnv,
} from "./libraryOps";

/** 병합 · 분리의 소스 쪽(L3) — 새 항목으로 놓기 · 원본 그대로 · 옮기기 백업 · 끊기면 아무것도 남지 않는다. */

const HEADER = 16;
const ECLIPSE: LibraryCover = { mode: "eclipse", seed: 0 };

/** 수순들의 모든 접두 국면 — 엔진 순서 + 메타데이터. */
function dbOf(lines: readonly (readonly Move[])[], label = 0x77): Blob {
  const map = new Map<string, Uint8Array>();
  for (const line of lines)
    for (let i = 0; i <= line.length; i++) {
      const k = keyOfMoves(2, 15, line.slice(0, i));
      map.set(k.join(","), k);
    }
  const keys = [...map.values()].sort((a, b) => compareYxdbKeys(a, 0, a.length, b, 0, b.length));
  const m = metaRecord();
  const out: Uint8Array[] = [];
  const w = new YxdbWriter(keys.length + 1, (c) => out.push(c), { blockKB: 64 });
  w.recordKV(m.key, 0, m.key.length, m.value, 0, m.value.length);
  keys.forEach((k, i) => {
    const v = i % 2 ? new Uint8Array([label, 0, 0, 0, 0]) : new Uint8Array(0);
    w.recordKV(k, 0, k.length, v, 0, v.length);
  });
  w.finish();
  return new Blob(out as BlobPart[]);
}

const lineA = [...representative(3), move(9, 9), move(5, 5)];
const lineB = [...representative(16), move(4, 9)];

/** 워커 대신 같은 몸통을 그 자리에서. */
const local = ((job: LibraryJob, onProgress?: (p: JobProgress) => void) => {
  let cancelled = false;
  return {
    promise: runJob(job, { isCancelled: () => cancelled, onProgress: onProgress ?? (() => {}) }),
    cancel: () => void (cancelled = true),
  };
}) as unknown as JobRunner;
const env: OpsEnv = { run: local, journalHeader: HEADER };

async function entryWith(title: string, file: Blob) {
  const e = (await createEntry(title, { select: false }))!;
  await browserSource.writeAtomic([{ name: e.file, data: file }], Date.now());
  return e;
}

beforeEach(async () => {
  await db()!.dbfiles.clear();
  await db()!.libraryMeta.clear();
  resetLibraryForTest();
});

describe("병합 — 소스", () => {
  it("새 항목으로 놓고 원본은 그대로", async () => {
    const a = await entryWith("가", dbOf([lineA]));
    const b = await entryWith("나", dbOf([lineB]));
    const prep = await previewMerge([a.id, b.id], { policy: "deeper", joinComments: true }, env)
      .promise;
    expect(prep.summary.overlaps).toBe(2); // 빈 판 · 천원
    const { entry, trashed } = await commitMerge(
      prep,
      { title: "가 + 나", cover: ECLIPSE, trashOriginals: false, attachedId: null },
      env,
    ).promise;
    expect(trashed).toEqual([]);
    const file = await browserSource.open(entry.file);
    expect(await countYxdb(file!)).toBe(prep.summary.records);
    expect((await listEntries()).map((e) => e.title).sort()).toEqual(["가", "가 + 나", "나"]);
    expect((await getEntry(entry.id))!.fingerprint?.size).toBe(file!.size);
  });

  it("원본을 휴지통으로 — 붙어 있는 DB 는 남긴다", async () => {
    const a = await entryWith("가", dbOf([lineA]));
    const b = await entryWith("나", dbOf([lineB]));
    const prep = await previewMerge([a.id, b.id], { policy: "base", joinComments: false }, env)
      .promise;
    const { trashed } = await commitMerge(
      prep,
      { title: "합", cover: ECLIPSE, trashOriginals: true, attachedId: a.id },
      env,
    ).promise;
    expect(trashed).toEqual([b.id]);
    expect((await listTrashed()).map((e) => e.id)).toEqual([b.id]);
  });

  it("워커가 끊기면(강제 종료 · 취소) 소스에 아무것도 남지 않는다", async () => {
    const a = await entryWith("가", dbOf([lineA]));
    const b = await entryWith("나", dbOf([lineB]));
    const prep = await previewMerge([a.id, b.id], { policy: "deeper", joinComments: true }, env)
      .promise;
    const before = await db()!.dbfiles.count();
    const crash = (() => ({
      promise: Promise.reject(new Error("library worker crashed")),
      cancel: () => {},
    })) as unknown as JobRunner;
    await expect(
      commitMerge(
        prep,
        { title: "x", cover: ECLIPSE, trashOriginals: true, attachedId: null },
        { run: crash, journalHeader: HEADER },
      ).promise,
    ).rejects.toThrow(/crashed/);
    const h = commitMerge(
      prep,
      { title: "y", cover: ECLIPSE, trashOriginals: true, attachedId: null },
      env,
    );
    h.cancel();
    await expect(h.promise).rejects.toBeInstanceOf(YxdbCancelled);
    expect(await db()!.dbfiles.count()).toBe(before);
    expect((await listEntries()).length).toBe(2);
    expect(await listTrashed()).toEqual([]);
  });

  it("미리 본 뒤 바뀌었거나 저널이 접히지 않았으면 받지 않는다", async () => {
    const a = await entryWith("가", dbOf([lineA]));
    const b = await entryWith("나", dbOf([lineB]));
    const prep = await previewMerge([a.id, b.id], { policy: "deeper", joinComments: true }, env)
      .promise;
    await browserSource.writeAtomic([{ name: b.file, data: dbOf([lineB, lineA]) }], Date.now());
    const commit = { title: "x", cover: ECLIPSE, trashOriginals: false, attachedId: null };
    await expect(commitMerge(prep, commit, env).promise).rejects.toThrow(/바뀌었습니다/);
    await browserSource.writeAtomic(
      [{ name: journalOf(a.file), data: new Blob([new Uint8Array(HEADER + 8)]) }],
      Date.now(),
    );
    await expect(
      previewMerge([a.id, b.id], { policy: "deeper", joinComments: true }, env).promise,
    ).rejects.toThrow(/저널/);
  });
});

describe("분리 — 소스", () => {
  it("옮기기 — 결과 + 나머지 = 원본, 원본 사본은 휴지통, 원본 파일은 나머지로", async () => {
    const whole = dbOf([lineA, lineB]);
    const a = await entryWith("원본", whole);
    const total = (await countYxdb(whole)) - 1;
    const { counts, size } = await previewSplit(a.id, null, env).promise;
    expect(counts.total).toBe(total);
    const { entries, backup } = await commitSplit(
      a.id,
      {
        plan: {
          criterion: "solved",
          outputs: [{ buckets: ["solved"], count: counts.solved }],
          rest: { count: total - counts.solved },
        },
        outputs: [{ title: "원본 · 풀린 국면", cover: ECLIPSE }],
        move: true,
        meta: counts.meta,
        size,
      },
      env,
    ).promise;
    const out = await browserSource.open(entries[0]!.file);
    const rest = await browserSource.open(a.file);
    expect((await countYxdb(out!)) - 1 + (await countYxdb(rest!)) - 1).toBe(total);
    expect((await countYxdb(rest!)) - 1).toBe(total - counts.solved);
    const trash = await listTrashed();
    expect(trash.map((e) => e.id)).toEqual([backup]);
    expect(trash[0]!.title).toContain("원본");
    // 원본 항목은 통계를 버렸다(다시 센다)
    expect((await getEntry(a.id))!.stats).toBeUndefined();
  });

  it("복사(기본) — 원본 파일은 그대로", async () => {
    const whole = dbOf([lineA, lineB]);
    const a = await entryWith("원본", whole);
    const { counts, size } = await previewSplit(a.id, null, env).promise;
    const idx = counts.openings!.map((n, i) => ({ n, i })).filter((x) => x.n > 0);
    const { entries, backup } = await commitSplit(
      a.id,
      {
        plan: { criterion: "opening", outputs: idx.map((x) => ({ buckets: [x.i], count: x.n })) },
        outputs: idx.map((x) => ({
          title: `주형 ${x.i}`,
          cover: { mode: "opening", seed: 0, opening: x.i },
        })),
        move: false,
        meta: true,
        size,
      },
      env,
    ).promise;
    expect(backup).toBeNull();
    expect(entries).toHaveLength(idx.length);
    expect((await browserSource.open(a.file))!.size).toBe(whole.size);
  });
});
