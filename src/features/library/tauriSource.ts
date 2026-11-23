import { MANIFEST_FILE, fnv1a64, TAIL_BYTES, type Fingerprint } from "../../data/library";
import {
  parseManifest,
  renderManifest,
  type FileWrite,
  type FolderSource,
  type LibraryFileInfo,
  type LibraryManifest,
  type SourceAccess,
} from "./source";

/**
 * 데스크톱 폴더 소스(라이브러리 계획 §3 · L4) — 파일 일은 셸의 Rust 명령(`Zenyth-desktop/src-tauri/src/library.rs`)이
 * 한다. 웹은 이 다리(`FolderBridge`)만 알고, 데스크톱 짝(`app/desktop/libraryBridge.ts`)이 `invoke` 로 잇는다.
 *
 * - 네이티브 엔진은 이 폴더의 파일을 `YXSETDATABASE <경로>` 로 **직접** 연다(복사 없음, `dbStore`). 그래서 `open()`
 *   (조각으로 읽어 `Blob` 을 만든다)은 통계 · 병합 · 분리 · 내보내기에만 쓴다.
 * - 쓰기는 조각(8MB)으로 흘려 셸이 곁의 임시 파일에 쓰고 끝에 바꿔 끼운다. 이름 바꾸기는 덮어쓰지 않고, Windows 의
 *   공유 위반(다른 프로그램이 쥔 파일)은 셸이 몇 번 다시 시도한다.
 * - 휴지통은 OS 휴지통 — 되돌리기는 셸이 원래 자리로 꺼낸다.
 */

export interface FolderBridge {
  pickFolder(): Promise<string | null>;
  /** 폴더가 있는가. */
  exists(dir: string): Promise<boolean>;
  list(dir: string): Promise<LibraryFileInfo[]>;
  stat(dir: string, name: string): Promise<LibraryFileInfo | null>;
  read(dir: string, name: string, offset: number, length: number): Promise<Uint8Array>;
  writeBegin(dir: string, name: string): Promise<number>;
  writeChunk(token: number, bytes: Uint8Array): Promise<void>;
  writeCommit(token: number): Promise<void>;
  writeAbort(token: number): Promise<void>;
  remove(dir: string, name: string): Promise<void>;
  /** 덮어쓰지 않는다. 저널 · 엔진 백업도 따라간다. 대소문자만 다르면 임시 이름을 거친다. */
  rename(dir: string, from: string, to: string): Promise<void>;
  /** OS 휴지통으로(짝 파일도). */
  trash(dir: string, name: string): Promise<void>;
  restore(dir: string, name: string): Promise<void>;
  purge(dir: string, name: string): Promise<void>;
}

const CHUNK = 8 << 20;

/** 폴더 경로 + 파일 이름 — 셸이 준 경로의 구분자를 따른다. */
export function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") || /^[A-Za-z]:/.test(dir) ? "\\" : "/";
  return dir.endsWith("\\") || dir.endsWith("/") ? dir + name : dir + sep + name;
}

/** 경로의 마지막 이름 — 칩에 쓴다. */
export const baseName = (path: string) =>
  path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() || path;

export class TauriFolderSource implements FolderSource {
  readonly kind = "tauri" as const;

  constructor(
    readonly id: string,
    readonly path: string,
    private readonly bridge: () => Promise<FolderBridge>,
    readonly label: string = baseName(path),
  ) {}

  /** 엔진에 줄 절대 경로. */
  pathOf(name: string): string {
    return joinPath(this.path, name);
  }

  async access(): Promise<SourceAccess> {
    try {
      return (await (await this.bridge()).exists(this.path)) ? "granted" : "missing";
    } catch {
      return "denied";
    }
  }

  requestAccess(): Promise<SourceAccess> {
    return this.access();
  }

  async list(): Promise<LibraryFileInfo[]> {
    return (await this.bridge()).list(this.path);
  }

  async stat(name: string): Promise<LibraryFileInfo | null> {
    return (await this.bridge()).stat(this.path, name);
  }

  /**
   * 조각으로 읽어 `Blob` 을 만든다 — 앞 `Blob` 에 조각을 이어 붙이므로(브라우저가 조각을 합치지 않고 참조한다) 힙에는
   * 한 조각만 머문다.
   */
  async open(name: string): Promise<Blob | null> {
    const b = await this.bridge();
    const st = await b.stat(this.path, name);
    if (!st) return null;
    let blob = new Blob([]);
    for (let off = 0; off < st.size; off += CHUNK) {
      const part = await b.read(this.path, name, off, Math.min(CHUNK, st.size - off));
      if (part.byteLength === 0) break;
      blob = new Blob([blob, part as BlobPart]);
    }
    return blob;
  }

  async fingerprint(name: string): Promise<Fingerprint | null> {
    const b = await this.bridge();
    const st = await b.stat(this.path, name);
    if (!st) return null;
    const off = Math.max(0, st.size - TAIL_BYTES);
    const tail = await b.read(this.path, name, off, st.size - off);
    return { size: st.size, mtime: st.mtime, tail: fnv1a64(tail) };
  }

  private async put(name: string, data: Blob): Promise<void> {
    const b = await this.bridge();
    const token = await b.writeBegin(this.path, name);
    try {
      for (let off = 0; off < data.size; off += CHUNK)
        await b.writeChunk(
          token,
          new Uint8Array(await data.slice(off, Math.min(data.size, off + CHUNK)).arrayBuffer()),
        );
      await b.writeCommit(token);
    } catch (e) {
      await b.writeAbort(token).catch(() => undefined);
      throw e;
    }
  }

  async writeAtomic(writes: readonly FileWrite[]): Promise<void> {
    const b = await this.bridge();
    for (const w of writes) {
      if (w.data) await this.put(w.name, w.data);
      else await b.remove(this.path, w.name);
    }
  }

  async rename(from: string, to: string): Promise<void> {
    await (await this.bridge()).rename(this.path, from, to);
  }

  async trash(name: string): Promise<string> {
    await (await this.bridge()).trash(this.path, name);
    return name;
  }

  async restore(trashName: string, name: string): Promise<void> {
    const b = await this.bridge();
    if (await b.stat(this.path, name)) throw new Error(`exists: ${name}`);
    await b.restore(this.path, trashName);
    if (trashName !== name) await b.rename(this.path, trashName, name);
  }

  async purge(trashName: string): Promise<void> {
    await (await this.bridge()).purge(this.path, trashName);
  }

  async readManifest(): Promise<LibraryManifest> {
    const b = await this.bridge();
    const st = await b.stat(this.path, MANIFEST_FILE);
    if (!st) return parseManifest(null);
    const bytes = await b.read(this.path, MANIFEST_FILE, 0, st.size);
    return parseManifest(new TextDecoder().decode(bytes));
  }

  async writeManifest(m: LibraryManifest): Promise<void> {
    await this.put(MANIFEST_FILE, new Blob([renderManifest(m)]));
  }
}
