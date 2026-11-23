import { db } from "../../data/db";
import {
  BROWSER_SOURCE_ID,
  defaultEntryTitle,
  journalOf,
  newEntry,
  type Fingerprint,
  type LibraryCover,
  type LibraryMetaRow,
} from "../../data/library";
import { browserSource, TRASH, TRASH_DAYS } from "./browserSource";
import { fileNameFor } from "./fileName";
import { saveManifest } from "./folderSync";
import { sourceOf } from "./sources";

/**
 * 라이브러리 항목 — 고르기 · 만들기 · 고치기(라이브러리 계획 §3 · L1). 붙은 항목(«지금 재생 중»)의 id 는
 * `localStorage` 의 `rapfi.db.active` 다(동기로 읽혀 첫 그림부터 맞다). 그 줄이 없거나 가리키는 항목이 사라졌으면
 * 마지막에 연 항목으로 물러선다.
 *
 * 항목은 소스를 가리지 않고 Dexie `libraryMeta` 에서 읽는다. 폴더 소스(L4)의 줄은 사이드카의 사본이라 고칠 때마다
 * 사이드카를 다시 쓴다(`saveManifest`). 파일 일은 항목의 `source` 로 고른 소스(`sourceOf`)가 한다.
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
/** 목록에 보이는 항목 — 휴지통에 없고, 폴더에서 사라지지 않았다. */
const live = (e: LibraryMetaRow) => !e.trashedAt && !e.missingSince;

/** 휴지통에 없는 항목 — 최근에 연 순. */
export async function listEntries(): Promise<LibraryMetaRow[]> {
  const d = db();
  if (!d) return [];
  const rows = await d.libraryMeta.toArray();
  return rows.filter(live).sort((a, b) => recency(b) - recency(a));
}

export async function getEntry(id: string): Promise<LibraryMetaRow | null> {
  const e = (await db()?.libraryMeta.get(id)) ?? null;
  return e && live(e) ? e : null;
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
 * 폴더 소스에서 제목으로 만든 비어 있는 파일 이름 — 폴더의 파일과 다른 항목(휴지통 · 새 DB 포함)이 쓰는 이름을
 * 피한다. `exceptId` 의 지금 이름은 비어 있는 것으로 본다(이름 바꾸기).
 */
export async function freeFileName(
  sourceId: string,
  title: string,
  exceptId?: string,
): Promise<string> {
  const src = sourceOf(sourceId);
  const rows = (await db()?.libraryMeta.where("source").equals(sourceId).toArray()) ?? [];
  const self = rows.find((r) => r.id === exceptId && !r.trashedAt)?.file;
  const taken = new Set<string>(
    rows.filter((r) => r.id !== exceptId && !r.trashedAt).map((r) => r.file),
  );
  for (const f of (await src?.list()) ?? []) if (f.name !== self) taken.add(f.name);
  return fileNameFor(title, taken);
}

/**
 * 파일 없는 새 항목을 만든다 — `select` 면 붙을 항목으로 고른다(처음 쓰는 사람의 «내 DB»). 라이브러리 화면의
 * [새 DB] · 가져오기는 고르지 않는다(붙은 DB 는 그대로). 저장소가 없으면 null.
 *
 * 폴더 소스는 제목에서 파일 이름을 만든다(`fileNameFor`) — 파일은 처음 저장(엔진) · 놓기(가져오기 · 병합)에서 생긴다.
 */
export async function createEntry(
  title: string,
  {
    select = true,
    source = BROWSER_SOURCE_ID,
    mode = "eclipse",
  }: { select?: boolean; source?: string; mode?: LibraryCover["mode"] } = {},
): Promise<LibraryMetaRow | null> {
  const d = db();
  if (!d) return null;
  const file = source === BROWSER_SOURCE_ID ? undefined : await freeFileName(source, title);
  const e = newEntry(source, title, { file, mode });
  if (select) e.lastOpenedAt = e.createdAt;
  await d.libraryMeta.put(e);
  if (select) writeActiveId(e.id);
  await saveManifest(source);
  return e;
}

/** 파일을 놓지 못한 새 항목을 걷는다(휴지통을 거치지 않는다 — 파일이 없다). */
export async function discardEntry(id: string): Promise<void> {
  const d = db();
  const e = await d?.libraryMeta.get(id);
  if (!d || !e) return;
  await d.libraryMeta.delete(id);
  await saveManifest(e.source);
}

/** 휴지통의 항목 — 최근에 지운 순. */
export async function listTrashed(): Promise<LibraryMetaRow[]> {
  const d = db();
  if (!d) return [];
  const rows = await d.libraryMeta.toArray();
  return rows.filter((e) => e.trashedAt).sort((a, b) => b.trashedAt! - a.trashedAt!);
}

/**
 * 항목을 휴지통으로 — 파일(+ 저널)도 소스의 휴지통으로(브라우저 `.trash/` · 웹 폴더 `.zenyth-trash/` · 데스크톱 OS
 * 휴지통). 붙을 항목이면 고른 것을 놓는다(다음에 연 것으로 물러선다).
 */
export async function trashEntry(id: string, now = Date.now()): Promise<void> {
  const e = await getEntry(id);
  if (!e) return;
  const src = sourceOf(e.source);
  let trashFile: string | undefined;
  if (src && (await src.stat(e.file))) trashFile = await src.trash(e.file);
  await updateEntry(id, { trashedAt: now, ...(trashFile ? { trashFile } : {}) });
  if (readActiveId() === id) writeActiveId(null);
}

/** 휴지통 속 이름 — 옛 브라우저 항목은 `.trash/<file>`. 파일 없이 지운 항목이면 null. */
async function trashNameOf(e: LibraryMetaRow): Promise<string | null> {
  if (e.trashFile) return e.trashFile;
  if (e.source !== BROWSER_SOURCE_ID) return null;
  return (await db()?.dbfiles.get(TRASH + e.file)) ? TRASH + e.file : null;
}

/**
 * 휴지통에서 되돌린다 — 파일이 휴지통에 없으면(파일 없이 지운 새 DB) 항목만. 폴더에 그새 같은 이름이 생겼으면
 * 비어 있는 이름(` (2)`)으로 되돌린다.
 */
export async function restoreEntry(id: string): Promise<void> {
  const d = db();
  const e = await d?.libraryMeta.get(id);
  if (!d || !e?.trashedAt) return;
  const src = sourceOf(e.source);
  const token = await trashNameOf(e);
  let file = e.file;
  if (src && token) {
    if (e.source !== BROWSER_SOURCE_ID && (await src.stat(file)))
      file = await freeFileName(e.source, e.title, e.id);
    await src.restore(token, file);
  }
  await d.libraryMeta
    .where("id")
    .equals(id)
    .modify((row) => {
      delete row.trashedAt;
      delete row.trashFile;
      row.file = file;
    });
  await saveManifest(e.source);
}

/** 휴지통에서 아주 지운다(파일까지). */
export async function purgeEntry(id: string): Promise<void> {
  const d = db();
  const e = await d?.libraryMeta.get(id);
  if (!d || !e?.trashedAt) return;
  if (e.source === BROWSER_SOURCE_ID) {
    const token = e.trashFile ?? TRASH + e.file;
    await d.transaction("rw", d.dbfiles, d.libraryMeta, async () => {
      await d.dbfiles.bulkDelete([token, journalOf(token)]);
      await d.libraryMeta.delete(id);
    });
    return;
  }
  const token = await trashNameOf(e);
  if (token) await sourceOf(e.source)?.purge(token);
  await d.libraryMeta.delete(id);
  await saveManifest(e.source);
}

/**
 * 기동 때 — 30일 지난 휴지통(파일 · 항목)을 치운다. 치운 항목 수. 웹 폴더의 `.zenyth-trash/` 도 비운다.
 * 데스크톱 OS 휴지통의 파일은 OS 가 다루게 두고 항목만 걷는다.
 */
export async function purgeLibraryTrash(now = Date.now()): Promise<number> {
  const d = db();
  if (!d) return 0;
  const before = now - TRASH_DAYS * 86_400_000;
  await browserSource.purgeTrash(before);
  const old = (await d.libraryMeta.toArray()).filter((e) => e.trashedAt && e.trashedAt < before);
  const touched = new Set<string>();
  for (const e of old) {
    if (e.source === BROWSER_SOURCE_ID) continue;
    const src = sourceOf(e.source);
    if (src?.kind === "fsa" && e.trashFile) await src.purge(e.trashFile).catch(() => undefined);
    touched.add(e.source);
  }
  await d.libraryMeta.bulkDelete(old.map((e) => e.id));
  for (const s of touched) await saveManifest(s);
  return old.length;
}

/** 항목을 고친다 — `drop` 의 칸은 지운다. 폴더 소스면 사이드카도 다시 쓴다. */
export async function updateEntry(
  id: string,
  patch: Partial<Omit<LibraryMetaRow, "id" | "source">>,
  drop: readonly (keyof LibraryMetaRow)[] = [],
): Promise<void> {
  const d = db();
  if (!d) return;
  if (drop.length)
    await d.libraryMeta
      .where("id")
      .equals(id)
      .modify((row) => {
        Object.assign(row, patch);
        for (const k of drop) delete (row as Partial<LibraryMetaRow>)[k];
      });
  else await d.libraryMeta.update(id, patch);
  const source = (await d.libraryMeta.get(id))?.source;
  if (source) await saveManifest(source);
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
  const source = (await d.libraryMeta.get(id))?.source;
  if (source) await saveManifest(source);
}

/** 시험 전용. */
export function resetLibraryForTest(): void {
  writeActiveId(null);
}
