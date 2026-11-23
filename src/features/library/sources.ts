import { IS_DESKTOP } from "../../app/desktop/platform";
import { db } from "../../data/db";
import { BROWSER_SOURCE_ID, newEntryId, type LibrarySourceRow } from "../../data/library";
import { browserSource } from "./browserSource";
import { FsaFolderSource, fsaSupported, pickFsaFolder, type FsaDir } from "./fsaSource";
import { isFolderSource, type FolderSource, type LibrarySource } from "./source";
import { baseName, TauriFolderSource, type FolderBridge } from "./tauriSource";

/**
 * 소스 목록(라이브러리 계획 §3 · L4) — Dexie `librarySources` 의 줄마다 소스 하나. 브라우저 소스는 늘 있고, 폴더
 * 소스는 사용자가 [+ 폴더 열기] 로 더한다(웹 Chromium = 폴더 핸들, 데스크톱 = 경로).
 *
 * 데스크톱의 파일 다리는 셸 안에서만 받아 온다(동적 import) — 웹 번들은 `@tauri-apps/api` 를 부르지 않는다.
 */

let bridgeOverride: FolderBridge | null = null;
let bridgePromise: Promise<FolderBridge> | null = null;

function folderBridge(): Promise<FolderBridge> {
  if (bridgeOverride) return Promise.resolve(bridgeOverride);
  if (!IS_DESKTOP) return Promise.reject(new Error("desktop only"));
  bridgePromise ??= import("../../app/desktop/libraryBridge").then((m) => m.createFolderBridge());
  return bridgePromise;
}

const cache = new Map<string, LibrarySource>();

function build(row: LibrarySourceRow): LibrarySource | null {
  if (row.kind === "fsa" && row.handle)
    return new FsaFolderSource(row.id, row.handle as FsaDir, row.label);
  if (row.kind === "tauri" && row.path)
    return new TauriFolderSource(row.id, row.path, folderBridge, row.label);
  return null;
}

/** 소스 줄을 다시 읽는다(기동 · 폴더를 더하고 뺀 뒤). */
export async function loadSources(): Promise<LibrarySourceRow[]> {
  const rows = (await db()?.librarySources.toArray()) ?? [];
  for (const r of rows) {
    if (r.kind === "browser" || cache.has(r.id)) continue;
    const s = build(r);
    if (s) cache.set(r.id, s);
  }
  for (const id of [...cache.keys()]) if (!rows.some((r) => r.id === id)) cache.delete(id);
  return rows.sort((a, b) => a.addedAt - b.addedAt);
}

/** 항목의 `source` → 소스. 모르는 폴더(줄이 지워졌거나 아직 읽지 않았다)는 null. */
export function sourceOf(id: string): LibrarySource | null {
  if (id === BROWSER_SOURCE_ID) return browserSource;
  return cache.get(id) ?? null;
}

/** 소스 줄을 아직 읽지 않았을 수 있는 곳(기동 직후의 `dbStore`) — 읽고 찾는다. */
export async function resolveSource(id: string): Promise<LibrarySource | null> {
  return sourceOf(id) ?? (await loadSources(), sourceOf(id));
}

export function folderSources(): FolderSource[] {
  return [...cache.values()].filter(isFolderSource);
}

/** 이 화면에서 폴더를 열 수 있는가 — 데스크톱은 늘, 웹은 Chromium 만. */
export const canOpenFolders = () => IS_DESKTOP || !!bridgeOverride || fsaSupported();

/**
 * [+ 폴더 열기] — 고르게 하고 줄을 더한다. 이미 있는 폴더면 그 줄을 돌려준다. 닫으면 null.
 * 웹은 사용자 몸짓(클릭) 안에서 불러야 한다.
 */
export async function addFolder(): Promise<LibrarySourceRow | null> {
  const d = db();
  if (!d) throw new Error("IndexedDB unavailable");
  const rows = await loadSources();
  if (IS_DESKTOP || bridgeOverride) {
    const path = await (await folderBridge()).pickFolder();
    if (!path) return null;
    const same = rows.find(
      (r) => r.kind === "tauri" && r.path?.toLowerCase() === path.toLowerCase(),
    );
    if (same) return same;
    const row: LibrarySourceRow = {
      id: newEntryId(),
      kind: "tauri",
      label: baseName(path),
      path,
      addedAt: Date.now(),
    };
    await d.librarySources.put(row);
    await loadSources();
    return row;
  }
  const dir = await pickFsaFolder();
  if (!dir) return null;
  for (const r of rows)
    if (r.kind === "fsa" && r.handle && (await (r.handle as FsaDir).isSameEntry?.(dir))) return r;
  const row: LibrarySourceRow = {
    id: newEntryId(),
    kind: "fsa",
    label: dir.name,
    handle: dir,
    addedAt: Date.now(),
  };
  await d.librarySources.put(row);
  await loadSources();
  return row;
}

/** 폴더를 라이브러리에서 뺀다 — 폴더의 파일과 사이드카는 그대로 둔다(다시 열면 이름 · 커버가 돌아온다). */
export async function removeFolder(id: string): Promise<void> {
  const d = db();
  if (!d || id === BROWSER_SOURCE_ID) return;
  await d.transaction("rw", d.librarySources, d.libraryMeta, async () => {
    await d.librarySources.delete(id);
    await d.libraryMeta.where("source").equals(id).delete();
  });
  cache.delete(id);
}

/** 시험 전용 — 데스크톱 다리를 갈아 끼운다(웹 시험에서 `TauriFolderSource` 를 돌린다). */
export function setFolderBridgeForTest(b: FolderBridge | null): void {
  bridgeOverride = b;
  cache.clear();
}

/** 시험 전용 — 소스 하나를 바로 심는다(가짜 FSA 핸들). */
export function putSourceForTest(s: LibrarySource): void {
  cache.set(s.id, s);
}
