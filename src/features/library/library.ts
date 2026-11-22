import { db } from "../../data/db";
import {
  defaultEntryTitle,
  journalOf,
  newBrowserEntry,
  type Fingerprint,
  type LibraryMetaRow,
} from "../../data/library";
import { browserSource, TRASH, TRASH_DAYS } from "./browserSource";

/**
 * 라이브러리 항목 — 고르기 · 만들기 · 고치기(라이브러리 계획 §3 · L1). 붙은 항목(«지금 재생 중»)의 id 는
 * `localStorage` 의 `rapfi.db.active` 다(동기로 읽혀 첫 그림부터 맞다). 그 줄이 없거나 가리키는 항목이 사라졌으면
 * 마지막에 연 항목으로 물러선다.
 *
 * L1 은 브라우저 소스만 — 폴더 소스(L4)가 오면 항목의 `source` 로 소스를 고른다.
 */

const ACTIVE_KEY = "rapfi.db.active";
/** `localStorage` 가 없는 곳(시험의 node · 막힌 저장소)의 대신. */
let memActive: string | null = null;

export function readActiveId(): string | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage.getItem(ACTIVE_KEY);
  } catch {
    /* 막힌 저장소 — 아래로 */
  }
  return memActive;
}

export function writeActiveId(id: string | null): void {
  memActive = id;
  try {
    if (typeof localStorage === "undefined") return;
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* 이번 세션만 */
  }
}

const recency = (e: LibraryMetaRow) => e.lastOpenedAt ?? e.updatedAt;

/** 휴지통에 없는 항목 — 최근에 연 순. */
export async function listEntries(): Promise<LibraryMetaRow[]> {
  const d = db();
  if (!d) return [];
  const rows = await d.libraryMeta.toArray();
  return rows.filter((e) => !e.trashedAt).sort((a, b) => recency(b) - recency(a));
}

export async function getEntry(id: string): Promise<LibraryMetaRow | null> {
  const e = (await db()?.libraryMeta.get(id)) ?? null;
  return e && !e.trashedAt ? e : null;
}

/** 붙을 항목 — 고른 것, 없으면 마지막에 연 것. 항목이 하나도 없으면 null. */
export async function resolveActive(): Promise<LibraryMetaRow | null> {
  const want = readActiveId();
  const e = want ? await getEntry(want) : null;
  if (e) return e;
  const fallback = (await listEntries())[0] ?? null;
  if (fallback?.id !== want) writeActiveId(fallback?.id ?? null);
  return fallback;
}

/** 붙을 항목 — 없으면 빈 «내 DB» 를 만든다(처음 쓰는 사람). 저장소가 없으면 null. */
export async function ensureActive(): Promise<LibraryMetaRow | null> {
  const e = await resolveActive();
  if (e) return e;
  return createEntry(defaultEntryTitle());
}

/**
 * 파일 없는 새 항목을 만든다 — `select` 면 붙을 항목으로 고른다(처음 쓰는 사람의 «내 DB»). 라이브러리 화면의
 * [새 DB] · 가져오기는 고르지 않는다(붙은 DB 는 그대로). 저장소가 없으면 null.
 */
export async function createEntry(
  title: string,
  { select = true }: { select?: boolean } = {},
): Promise<LibraryMetaRow | null> {
  const d = db();
  if (!d) return null;
  const e = newBrowserEntry(title);
  if (select) e.lastOpenedAt = e.createdAt;
  await d.libraryMeta.put(e);
  if (select) writeActiveId(e.id);
  return e;
}

/** 휴지통의 항목 — 최근에 지운 순. */
export async function listTrashed(): Promise<LibraryMetaRow[]> {
  const d = db();
  if (!d) return [];
  const rows = await d.libraryMeta.toArray();
  return rows.filter((e) => e.trashedAt).sort((a, b) => b.trashedAt! - a.trashedAt!);
}

/** 항목을 휴지통으로 — 파일(+ 저널)도 `.trash/` 로. 붙을 항목이면 고른 것을 놓는다(다음에 연 것으로 물러선다). */
export async function trashEntry(id: string, now = Date.now()): Promise<void> {
  const e = await getEntry(id);
  if (!e) return;
  if ((await browserSource.open(e.file)) !== null) await browserSource.trash(e.file);
  await updateEntry(id, { trashedAt: now });
  if (readActiveId() === id) writeActiveId(null);
}

/** 휴지통에서 되돌린다 — 파일이 휴지통에 없으면(파일 없이 지운 새 DB) 항목만. */
export async function restoreEntry(id: string): Promise<void> {
  const d = db();
  const e = await d?.libraryMeta.get(id);
  if (!d || !e?.trashedAt) return;
  const files = await d.dbfiles.get(TRASH + e.file);
  if (files) await browserSource.restore(e.file);
  await d.libraryMeta
    .where("id")
    .equals(id)
    .modify((row) => {
      delete row.trashedAt;
    });
}

/** 휴지통에서 아주 지운다(파일까지). */
export async function purgeEntry(id: string): Promise<void> {
  const d = db();
  const e = await d?.libraryMeta.get(id);
  if (!d || !e?.trashedAt) return;
  await d.transaction("rw", d.dbfiles, d.libraryMeta, async () => {
    await d.dbfiles.bulkDelete([TRASH + e.file, TRASH + journalOf(e.file)]);
    await d.libraryMeta.delete(id);
  });
}

/** 기동 때 — 30일 지난 휴지통(파일 · 항목)을 치운다. 치운 항목 수. */
export async function purgeLibraryTrash(now = Date.now()): Promise<number> {
  const d = db();
  if (!d) return 0;
  const before = now - TRASH_DAYS * 86_400_000;
  await browserSource.purgeTrash(before);
  const old = (await d.libraryMeta.toArray()).filter((e) => e.trashedAt && e.trashedAt < before);
  await d.libraryMeta.bulkDelete(old.map((e) => e.id));
  return old.length;
}

export async function updateEntry(
  id: string,
  patch: Partial<Omit<LibraryMetaRow, "id" | "source">>,
): Promise<void> {
  await db()?.libraryMeta.update(id, patch);
}

/** 이 항목을 붙을 항목으로 — 연 시각을 적는다. 없는 항목이면 false. */
export async function selectEntry(id: string): Promise<boolean> {
  if (!(await getEntry(id))) return false;
  writeActiveId(id);
  await updateEntry(id, { lastOpenedAt: Date.now() });
  return true;
}

/**
 * 저장을 적는다 — 본 파일이 바뀌었으면(`fingerprint` 를 주면) 정체를 갈고 통계를 버린다(다시 센다).
 * `null` 이면 본 파일이 없어졌다(지우기). 저널만 바뀐 저장은 `fingerprint` 를 주지 않는다.
 */
export async function recordSaved(
  id: string,
  savedAt: number,
  fingerprint?: Fingerprint | null,
): Promise<void> {
  const d = db();
  if (!d) return;
  await d.libraryMeta
    .where("id")
    .equals(id)
    .modify((e) => {
      e.updatedAt = savedAt;
      if (fingerprint === undefined) return;
      if (fingerprint) e.fingerprint = fingerprint;
      else delete e.fingerprint;
      delete e.stats;
    });
}

/** 시험 전용. */
export function resetLibraryForTest(): void {
  writeActiveId(null);
}
