import { db, type RapfiDb } from "../../data/db";
import { BROWSER_SOURCE_ID, journalOf, type LibraryMetaRow } from "../../data/library";
import type { FileWrite, LibraryFileInfo, LibraryManifest, LibrarySource } from "./source";

/**
 * 브라우저 소스(라이브러리 계획 §3 · L1) — 모든 브라우저. 파일은 Dexie `dbfiles` 의 Blob 줄(`lib/<id>`,
 * `lib/<id>.journal`), 매니페스트는 `libraryMeta` 의 줄들(`source === "browser"`).
 *
 * 휴지통은 앱 안(`.trash/` 앞붙이) — 지운 시각은 줄의 `savedAt` 에 둔다. 30일이 지나면 `purgeTrash` 가 치운다.
 */

const TRASH = ".trash/";
export const TRASH_DAYS = 30;

export class BrowserSource implements LibrarySource {
  readonly id = BROWSER_SOURCE_ID;
  readonly kind = "browser" as const;

  constructor(private readonly conn: () => RapfiDb | null = db) {}

  private d(): RapfiDb {
    const d = this.conn();
    if (!d) throw new Error("IndexedDB unavailable");
    return d;
  }

  async list(): Promise<LibraryFileInfo[]> {
    const rows = await this.d().dbfiles.toArray();
    return rows
      .filter((r) => !r.name.startsWith(TRASH))
      .map((r) => ({ name: r.name, size: r.data.size, mtime: r.savedAt }));
  }

  async open(name: string): Promise<Blob | null> {
    return (await this.d().dbfiles.get(name))?.data ?? null;
  }

  /** 바꾼 시각 — 정체(`fingerprint`)의 `mtime`. 없으면 null. */
  async mtime(name: string): Promise<number | null> {
    return (await this.d().dbfiles.get(name))?.savedAt ?? null;
  }

  async writeAtomic(writes: readonly FileWrite[], savedAt = Date.now()): Promise<void> {
    const d = this.d();
    await d.transaction("rw", d.dbfiles, async () => {
      for (const w of writes) {
        if (w.data) await d.dbfiles.put({ name: w.name, data: w.data, savedAt });
        else await d.dbfiles.delete(w.name);
      }
    });
  }

  async rename(from: string, to: string): Promise<void> {
    const d = this.d();
    await d.transaction("rw", d.dbfiles, async () => {
      if (await d.dbfiles.get(to)) throw new Error(`exists: ${to}`);
      await this.move(d, from, to);
    });
  }

  async trash(name: string): Promise<void> {
    const d = this.d();
    await d.transaction("rw", d.dbfiles, () => this.move(d, name, TRASH + name, Date.now()));
  }

  /** 휴지통에서 되돌린다 — 그 자리에 새 파일이 생겼으면 실패. */
  async restore(name: string): Promise<void> {
    await this.rename(TRASH + name, name);
  }

  /** 휴지통에서 `before` 보다 먼저 지운 파일을 아주 지운다. 지운 수. */
  async purgeTrash(before = Date.now() - TRASH_DAYS * 86_400_000): Promise<number> {
    const d = this.d();
    return d.transaction("rw", d.dbfiles, async () => {
      const old = (await d.dbfiles.toArray())
        .filter((r) => r.name.startsWith(TRASH) && r.savedAt < before)
        .map((r) => r.name);
      await d.dbfiles.bulkDelete(old);
      return old.length;
    });
  }

  /** 본 파일과 저널을 함께 옮긴다(트랜잭션 안에서 부른다). `stamp` 가 있으면 그 시각으로 적는다. */
  private async move(d: RapfiDb, from: string, to: string, stamp?: number): Promise<void> {
    for (const [a, b] of [
      [from, to],
      [journalOf(from), journalOf(to)],
    ] as const) {
      const row = await d.dbfiles.get(a);
      if (!row) {
        if (a === from) throw new Error(`missing: ${from}`);
        continue;
      }
      await d.dbfiles.put({ ...row, name: b, savedAt: stamp ?? row.savedAt });
      await d.dbfiles.delete(a);
    }
  }

  async readManifest(): Promise<LibraryManifest> {
    const rows = await this.d().libraryMeta.where("source").equals(this.id).toArray();
    return { version: 1, entries: rows.map(({ source: _s, ...e }) => e) };
  }

  async writeManifest(m: LibraryManifest): Promise<void> {
    const d = this.d();
    await d.transaction("rw", d.libraryMeta, async () => {
      await d.libraryMeta.where("source").equals(this.id).delete();
      await d.libraryMeta.bulkPut(
        m.entries.map((e): LibraryMetaRow => ({ ...e, source: this.id })),
      );
    });
  }
}

export const browserSource = new BrowserSource();
