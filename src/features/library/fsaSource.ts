import { FOLDER_TRASH, MANIFEST_FILE, fingerprintOf, type Fingerprint } from "../../data/library";
import {
  companionSuffix,
  parseManifest,
  renderManifest,
  type FileWrite,
  type FolderSource,
  type LibraryFileInfo,
  type LibraryManifest,
  type SourceAccess,
} from "./source";

/**
 * 웹 폴더 소스(라이브러리 계획 §3 · L4) — Chromium 의 File System Access. 폴더 핸들은 Dexie `librarySources` 에
 * 둔다(구조화 복제로 저장된다). 다시 찾아오면 권한이 `prompt` 로 돌아가므로 칩의 «폴더 다시 허용»(사용자 몸짓)이
 * `requestAccess` 를 부른다.
 *
 * - 쓰기: `createWritable()` 은 곁의 임시 파일(`.crswap`)에 쓰고 `close()` 때 바꿔 끼운다 — 끊겨도 본 파일은 그대로.
 * - 이름 바꾸기: `handle.move()`(없는 브라우저는 복사 → 지우기). 덮어쓰지 않는다.
 * - 휴지통: 폴더 안 `.zenyth-trash/` — 이름이 겹치지 않게 앞에 지운 시각을 붙인다.
 *
 * lib.dom 에 없는 부분(권한 · `move` · `entries`)이 있어 쓰는 만큼만 아래에 적었다 — 시험의 가짜 핸들도 이 모양이다.
 */

export interface FsaFile {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(opts?: { keepExistingData?: boolean }): Promise<{
    write(data: Blob | BufferSource | string): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
  /** `move(이름)` 은 같은 폴더 안, `move(폴더, 이름)` 은 다른 폴더로. */
  move?: (a: FsaDir | string, b?: string) => Promise<void>;
}

export interface FsaDir {
  readonly kind: "directory";
  readonly name: string;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FsaFile>;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FsaDir>;
  removeEntry(name: string): Promise<void>;
  entries(): AsyncIterable<[string, FsaFile | FsaDir]>;
  queryPermission?(d: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(d: { mode: "readwrite" }): Promise<PermissionState>;
  isSameEntry?(other: FsaDir): Promise<boolean>;
}

const isNotFound = (e: unknown) =>
  e instanceof DOMException
    ? e.name === "NotFoundError" || e.name === "NotFoundErr"
    : (e as { name?: string })?.name === "NotFoundError";

/** 브라우저가 폴더 고르기를 주는가(Chromium). Firefox · Safari 는 폴더 칩을 숨긴다. */
export const fsaSupported = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

/** 폴더를 고르게 한다 — 사용자가 닫으면 null. */
export async function pickFsaFolder(): Promise<FsaDir | null> {
  const pick = (
    window as unknown as {
      showDirectoryPicker: (o: { mode: "readwrite"; id?: string }) => Promise<FsaDir>;
    }
  ).showDirectoryPicker;
  try {
    return await pick({ mode: "readwrite", id: "zenyth-library" });
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") return null;
    throw e;
  }
}

export class FsaFolderSource implements FolderSource {
  readonly kind = "fsa" as const;

  constructor(
    readonly id: string,
    private readonly dir: FsaDir,
    readonly label: string = dir.name,
  ) {}

  async access(): Promise<SourceAccess> {
    try {
      const p = (await this.dir.queryPermission?.({ mode: "readwrite" })) ?? "granted";
      if (p !== "granted") return p === "denied" ? "denied" : "prompt";
      // 허용됐어도 폴더가 지워졌으면 읽기에서 NotFound 다.
      await this.dir.entries()[Symbol.asyncIterator]().next();
      return "granted";
    } catch (e) {
      return isNotFound(e) ? "missing" : "denied";
    }
  }

  async requestAccess(): Promise<SourceAccess> {
    try {
      const p = (await this.dir.requestPermission?.({ mode: "readwrite" })) ?? "granted";
      return p === "granted" ? this.access() : p === "denied" ? "denied" : "prompt";
    } catch (e) {
      return isNotFound(e) ? "missing" : "denied";
    }
  }

  private async file(name: string): Promise<FsaFile | null> {
    try {
      return await this.dir.getFileHandle(name);
    } catch (e) {
      if (isNotFound(e) || (e as { name?: string })?.name === "TypeMismatchError") return null;
      throw e;
    }
  }

  private async exists(name: string): Promise<boolean> {
    return (await this.file(name)) !== null;
  }

  async list(): Promise<LibraryFileInfo[]> {
    const out: LibraryFileInfo[] = [];
    for await (const [name, h] of this.dir.entries()) {
      if (h.kind !== "file" || name.startsWith(".") || name === MANIFEST_FILE) continue;
      if (name.endsWith(".crswap")) continue;
      const f = await h.getFile();
      out.push({ name, size: f.size, mtime: f.lastModified });
    }
    return out;
  }

  async stat(name: string): Promise<LibraryFileInfo | null> {
    const h = await this.file(name);
    if (!h) return null;
    const f = await h.getFile();
    return { name, size: f.size, mtime: f.lastModified };
  }

  async open(name: string): Promise<Blob | null> {
    const h = await this.file(name);
    return h ? h.getFile() : null;
  }

  async fingerprint(name: string): Promise<Fingerprint | null> {
    const f = await this.open(name);
    return f ? fingerprintOf(f, (f as File).lastModified ?? Date.now()) : null;
  }

  private async put(dir: FsaDir, name: string, data: Blob | BufferSource | string): Promise<void> {
    const h = await dir.getFileHandle(name, { create: true });
    const w = await h.createWritable({ keepExistingData: false });
    try {
      await w.write(data);
      await w.close();
    } catch (e) {
      await w.abort().catch(() => undefined);
      throw e;
    }
  }

  private async remove(dir: FsaDir, name: string): Promise<void> {
    try {
      await dir.removeEntry(name);
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
  }

  async writeAtomic(writes: readonly FileWrite[]): Promise<void> {
    for (const w of writes) {
      if (w.data) await this.put(this.dir, w.name, w.data);
      else await this.remove(this.dir, w.name);
    }
  }

  /** 파일 하나를 옮긴다 — `move()` 가 없으면 복사 → 지우기. 덮어쓰지 않는 것은 부르는 쪽이 본다. */
  private async moveOne(from: FsaDir, name: string, to: FsaDir, toName: string): Promise<void> {
    const h = await from.getFileHandle(name);
    if (typeof h.move === "function") {
      try {
        if (to === from) await h.move(toName);
        else await h.move(to, toName);
        return;
      } catch (e) {
        // 일부 판은 로컬 폴더의 move 를 막는다(NotSupported · InvalidModification) — 복사로 물러선다.
        const n = (e as { name?: string })?.name;
        if (n !== "NotSupportedError" && n !== "InvalidModificationError") throw e;
      }
    }
    await this.put(to, toName, await h.getFile());
    await from.removeEntry(name);
  }

  /** 본 파일과 짝(저널 · 백업) — 짝 꼬리 목록. */
  private async companions(dir: FsaDir, base: string): Promise<string[]> {
    const out: string[] = [];
    for await (const [name, h] of dir.entries()) {
      if (h.kind !== "file") continue;
      const sfx = companionSuffix(base, name);
      if (sfx) out.push(sfx);
    }
    return out;
  }

  async rename(from: string, to: string): Promise<void> {
    if (!(await this.exists(from))) throw new Error(`missing: ${from}`);
    const caseOnly = from !== to && from.toLowerCase() === to.toLowerCase();
    if (!caseOnly && (await this.exists(to))) throw new Error(`exists: ${to}`);
    const tails = await this.companions(this.dir, from);
    for (const sfx of tails)
      if (!caseOnly && (await this.exists(to + sfx))) throw new Error(`exists: ${to + sfx}`);
    for (const [a, b] of [["", ""], ...tails.map((s) => [s, s])] as const) {
      if (caseOnly) {
        // 대소문자만 다른 이름 — 임시 이름을 거쳐 두 번(같은 이름으로 보는 파일 시스템).
        const tmp = `${from}${a}.zenyth-rename`;
        await this.moveOne(this.dir, from + a, this.dir, tmp);
        await this.moveOne(this.dir, tmp, this.dir, to + b);
      } else await this.moveOne(this.dir, from + a, this.dir, to + b);
    }
  }

  private trashDir(create: boolean): Promise<FsaDir> {
    return this.dir.getDirectoryHandle(FOLDER_TRASH, { create });
  }

  async trash(name: string): Promise<string> {
    const bin = await this.trashDir(true);
    const token = `${Date.now()}-${name}`;
    const tails = await this.companions(this.dir, name);
    await this.moveOne(this.dir, name, bin, token);
    for (const sfx of tails) await this.moveOne(this.dir, name + sfx, bin, token + sfx);
    return token;
  }

  async restore(trashName: string, name: string): Promise<void> {
    const bin = await this.trashDir(false);
    if (await this.exists(name)) throw new Error(`exists: ${name}`);
    const tails = await this.companions(bin, trashName);
    await this.moveOne(bin, trashName, this.dir, name);
    for (const sfx of tails) await this.moveOne(bin, trashName + sfx, this.dir, name + sfx);
  }

  async purge(trashName: string): Promise<void> {
    let bin: FsaDir;
    try {
      bin = await this.trashDir(false);
    } catch (e) {
      if (isNotFound(e)) return;
      throw e;
    }
    const tails = await this.companions(bin, trashName);
    await this.remove(bin, trashName);
    for (const sfx of tails) await this.remove(bin, trashName + sfx);
  }

  async readManifest(): Promise<LibraryManifest> {
    const f = await this.open(MANIFEST_FILE);
    return parseManifest(f ? await f.text() : null);
  }

  async writeManifest(m: LibraryManifest): Promise<void> {
    await this.put(this.dir, MANIFEST_FILE, renderManifest(m));
  }
}
