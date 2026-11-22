import type { LibraryEntry, SourceKind } from "../../data/library";

/**
 * 라이브러리의 소스 — yixindb 파일 여럿이 사는 곳(라이브러리 계획 §3).
 *
 * ```
 * LibrarySource
 *  ├ BrowserSource      모든 브라우저 · Dexie (L1, 기본. 옛 rapfi.db 가 첫 항목 «내 DB»)
 *  ├ FsaFolderSource    웹 Chromium · File System Access (L4)
 *  └ TauriFolderSource  데스크톱 · Rust 명령 (L4)
 * ```
 *
 * 소스는 **파일**과 **메타데이터(매니페스트)**만 안다. 어느 항목이 붙었는지 · 엔진에 넣고 빼기는 `dbStore` 가,
 * 항목을 만들고 고르는 일은 `library.ts` 가 한다.
 */

/** 폴더 소스의 `zenyth-library.json` 과 같은 모양 — 브라우저 소스는 Dexie 의 `libraryMeta` 에 줄로 둔다. */
export interface LibraryManifest {
  version: 1;
  entries: LibraryEntry[];
}

export interface LibraryFileInfo {
  name: string;
  size: number;
  mtime: number;
}

/** 원자적 쓰기 하나 — `data === null` 이면 그 파일을 지운다. */
export interface FileWrite {
  name: string;
  data: Blob | null;
}

export interface LibrarySource {
  readonly id: string;
  readonly kind: SourceKind;
  /** 소스에 실제로 있는 파일(저널 포함). 휴지통의 것은 빼고. */
  list(): Promise<LibraryFileInfo[]>;
  /** 파일을 연다 — `stream()` 으로 흘려 읽는다. 없으면 null. */
  open(name: string): Promise<Blob | null>;
  /**
   * 여러 파일을 한꺼번에 — 본 파일과 저널은 짝이라 함께 놓여야 한다. 브라우저 소스는 한 트랜잭션,
   * 폴더 소스는 파일마다 임시 파일 → 바꿔 끼우기.
   */
  writeAtomic(writes: readonly FileWrite[]): Promise<void>;
  /** 덮어쓰지 않는다 — `to` 가 있으면 실패. 저널도 따라간다. */
  rename(from: string, to: string): Promise<void>;
  /** 휴지통으로 — 저널도 따라간다. */
  trash(name: string): Promise<void>;
  readManifest(): Promise<LibraryManifest>;
  writeManifest(m: LibraryManifest): Promise<void>;
}
