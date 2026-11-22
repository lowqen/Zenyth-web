import { db } from "../../data/db";
import {
  defaultEntryTitle,
  newBrowserEntry,
  type Fingerprint,
  type LibraryMetaRow,
} from "../../data/library";

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

/** 파일 없는 새 항목을 만들고 고른다. 저장소가 없으면 null. */
export async function createEntry(title: string): Promise<LibraryMetaRow | null> {
  const d = db();
  if (!d) return null;
  const e = newBrowserEntry(title);
  e.lastOpenedAt = e.createdAt;
  await d.libraryMeta.put(e);
  writeActiveId(e.id);
  return e;
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
