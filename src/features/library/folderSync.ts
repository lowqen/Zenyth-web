import { db } from "../../data/db";
import {
  BROWSER_SOURCE_ID,
  newEntry,
  newEntryId,
  sameFingerprint,
  type Fingerprint,
  type LibraryEntry,
  type LibraryMetaRow,
} from "../../data/library";
import { isDbFileName, type LibraryFileInfo, type LibrarySource } from "./source";
import { sourceOf } from "./sources";

/**
 * 폴더 소스의 사이드카(`zenyth-library.json`) ↔ 폴더의 파일 ↔ Dexie `libraryMeta`(라이브러리 계획 §3 · L4).
 *
 * **사이드카가 정본**이고 Dexie 줄은 화면 · `dbStore` 가 소스를 가리지 않고 읽는 사본이다. 폴더를 열 때마다
 * (`syncFolder`) 사이드카와 실제 파일을 맞추고, 앱 안에서 메타데이터가 바뀌면(`saveManifest`) 사이드카를 다시 쓴다.
 *
 * 맞추기(`reconcile`):
 * 1. 사이드카 항목의 파일이 있으면 그대로 — 크기나 바꾼 시각이 다르면(다른 프로그램이 썼다) 정체를 다시 재고, 다르면
 *    통계를 버린다(다시 센다).
 * 2. 파일이 없어진 항목은 짝 없는 `.db` 파일과 **정체(크기 + 끝 4KB)로 다시 짝짓는다** — 앱 밖에서 이름을 바꾼 경우.
 * 3. 그래도 없으면 `missingSince` 를 적고 목록에서 숨긴다. 30일 지나면 버린다. 파일 없이 만든 새 DB(아직 저장 전,
 *    정체 없음)는 그대로 둔다 — 엔진이 처음 저장하면 그 이름으로 생긴다.
 * 4. 남은 `.db` 파일은 새 항목 — 제목은 파일 이름, 커버는 «자동»(2026-11-23 결정).
 * 5. 다른 소스에 같은 id 가 있으면(폴더를 통째로 복사한 경우) 새 id 를 준다.
 */

export const MISSING_DAYS = 30;

export interface ReconcileInput {
  sourceId: string;
  entries: readonly LibraryEntry[];
  files: readonly LibraryFileInfo[];
  fingerprint: (name: string) => Promise<Fingerprint | null>;
  /** 다른 소스가 쓰는 항목 id. */
  takenIds: ReadonlySet<string>;
  now?: number;
}

export async function reconcile({
  sourceId,
  entries,
  files,
  fingerprint,
  takenIds,
  now = Date.now(),
}: ReconcileInput): Promise<{ rows: LibraryMetaRow[]; changed: boolean }> {
  let changed = false;
  const dbFiles = files.filter((f) => isDbFileName(f.name));
  const byName = new Map(dbFiles.map((f) => [f.name.normalize("NFC").toLowerCase(), f]));
  const claimed = new Set<string>();
  const key = (n: string) => n.normalize("NFC").toLowerCase();
  const fps = new Map<string, Fingerprint | null>();
  const fpOf = async (name: string) => {
    if (!fps.has(name)) fps.set(name, await fingerprint(name));
    return fps.get(name) ?? null;
  };

  const rows: LibraryMetaRow[] = [];
  const pending: LibraryMetaRow[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const row: LibraryMetaRow = { ...e, source: sourceId };
    if (takenIds.has(row.id) || seen.has(row.id)) {
      row.id = newEntryId();
      changed = true;
    }
    seen.add(row.id);
    if (row.trashedAt) {
      rows.push(row);
      continue;
    }
    if (row.missingSince && now - row.missingSince > MISSING_DAYS * 86_400_000) {
      changed = true;
      continue;
    }
    const f = byName.get(key(row.file));
    if (!f || claimed.has(key(f.name))) {
      pending.push(row);
      continue;
    }
    claimed.add(key(f.name));
    if (f.name !== row.file) {
      row.file = f.name;
      changed = true;
    }
    if (row.missingSince) {
      delete row.missingSince;
      changed = true;
    }
    const fp0 = row.fingerprint;
    if (!fp0 || fp0.size !== f.size || fp0.mtime !== f.mtime) {
      const fp = await fpOf(f.name);
      if (fp) {
        if (!sameFingerprint(fp0, fp)) delete row.stats;
        row.fingerprint = fp;
        changed = true;
      }
    }
    rows.push(row);
  }

  // 2. 없어진 항목 ↔ 짝 없는 파일 — 정체로.
  const free = () => dbFiles.filter((f) => !claimed.has(key(f.name)));
  for (const row of pending) {
    if (row.fingerprint) {
      for (const f of free()) {
        if (f.size !== row.fingerprint.size) continue;
        const fp = await fpOf(f.name);
        if (!sameFingerprint(fp ?? undefined, row.fingerprint)) continue;
        claimed.add(key(f.name));
        row.file = f.name;
        row.fingerprint = fp!;
        delete row.missingSince;
        changed = true;
        break;
      }
    }
    // 3. 그래도 없다 — 저장된 적 있는 항목만 «사라짐».
    if (!claimed.has(key(row.file)) && row.fingerprint && !row.missingSince) {
      row.missingSince = now;
      changed = true;
    }
    rows.push(row);
  }

  // 4. 새 파일.
  for (const f of free()) {
    const row = newEntry(sourceId, f.name.replace(/\.db$/i, "") || f.name, {
      file: f.name,
      mode: "auto",
      now,
    });
    if (takenIds.has(row.id)) row.id = newEntryId();
    const fp = await fpOf(f.name);
    if (fp) row.fingerprint = fp;
    row.updatedAt = f.mtime || now;
    rows.push(row);
    changed = true;
  }
  return { rows, changed };
}

const strip = ({ source: _s, ...e }: LibraryMetaRow): LibraryEntry => e;

/**
 * 폴더를 맞춘다 — 사이드카 + 파일 → Dexie 줄(이 소스의 것을 통째로 갈아 끼운다), 달라졌으면 사이드카도 다시 쓴다.
 * 사이드카가 아직 없으면(처음 여는 폴더 · 누가 지웠다) Dexie 에 남은 줄을 바탕으로 삼는다.
 */
export async function syncFolder(src: LibrarySource, now = Date.now()): Promise<LibraryMetaRow[]> {
  const d = db();
  if (!d || src.id === BROWSER_SOURCE_ID) return [];
  const [manifest, files, all] = await Promise.all([
    src.readManifest(),
    src.list(),
    d.libraryMeta.toArray(),
  ]);
  const mine = all.filter((r) => r.source === src.id);
  const base = manifest.entries.length ? manifest.entries : mine.map(strip);
  const takenIds = new Set(all.filter((r) => r.source !== src.id).map((r) => r.id));
  const { rows, changed } = await reconcile({
    sourceId: src.id,
    entries: base,
    files,
    fingerprint: (n) => src.fingerprint(n),
    takenIds,
    now,
  });
  await d.transaction("rw", d.libraryMeta, async () => {
    await d.libraryMeta.where("source").equals(src.id).delete();
    await d.libraryMeta.bulkPut(rows);
  });
  if (changed || !manifest.entries.length) await saveManifest(src.id);
  return rows;
}

const chains = new Map<string, Promise<void>>();

/**
 * 이 소스의 Dexie 줄로 사이드카를 다시 쓴다 — 소스마다 한 줄로 세워 겹쳐 쓰지 않는다. 실패는 삼킨다(Dexie 사본은
 * 남고, 다음 쓰기 · 다음 맞추기가 다시 쓴다). 브라우저 소스는 할 일이 없다.
 */
export function saveManifest(sourceId: string): Promise<void> {
  if (sourceId === BROWSER_SOURCE_ID) return Promise.resolve();
  const src = sourceOf(sourceId);
  const d = db();
  if (!src || !d) return Promise.resolve();
  const next = (chains.get(sourceId) ?? Promise.resolve()).then(async () => {
    try {
      const rows = await d.libraryMeta.where("source").equals(sourceId).toArray();
      await src.writeManifest({ version: 1, entries: rows.map(strip) });
    } catch (e) {
      console.warn("[library] 사이드카를 쓰지 못했다", e);
    }
  });
  chains.set(sourceId, next);
  return next;
}
