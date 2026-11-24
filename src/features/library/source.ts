import type { Fingerprint, LibraryEntry, SourceKind } from "../../data/library";

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
 * 항목을 만들고 고르는 일은 `library.ts` 가, 폴더의 파일과 사이드카를 맞추는 일은 `folderSync.ts` 가 한다.
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

/** 폴더에 닿을 수 있는가 — 웹 폴더는 다시 찾아오면 `prompt`(사용자 몸짓으로 다시 허용), 폴더가 없어지면 `missing`. */
export type SourceAccess = "granted" | "prompt" | "denied" | "missing";

export interface LibrarySource {
  readonly id: string;
  readonly kind: SourceKind;
  /** 소스에 실제로 있는 파일(저널 포함). 휴지통 · 사이드카 · 임시 파일은 빼고. */
  list(): Promise<LibraryFileInfo[]>;
  /** 크기 · 바꾼 시각만 — 파일을 읽지 않는다. 없으면 null. */
  stat(name: string): Promise<LibraryFileInfo | null>;
  /** 파일을 연다 — `stream()` 으로 흘려 읽는다. 없으면 null. */
  open(name: string): Promise<Blob | null>;
  /** 크기 + 끝 4KB 해시 — 끝만 읽는다. 없으면 null. */
  fingerprint(name: string): Promise<Fingerprint | null>;
  /**
   * 여러 파일을 한꺼번에 — 본 파일과 저널은 짝이라 함께 놓여야 한다. 브라우저 소스는 한 트랜잭션,
   * 폴더 소스는 파일마다 임시 파일 → 바꿔 끼우기.
   */
  writeAtomic(writes: readonly FileWrite[]): Promise<void>;
  /** 덮어쓰지 않는다 — `to` 가 있으면 실패. 저널(폴더 소스는 엔진의 백업까지)도 따라간다. */
  rename(from: string, to: string): Promise<void>;
  /** 휴지통으로 — 저널도 따라간다. 휴지통 속 이름(되돌리기 · 아주 지우기의 열쇠)을 돌려준다. */
  trash(name: string): Promise<string>;
  /** 휴지통에서 `name` 으로 되돌린다 — 그 자리에 파일이 있으면 실패. */
  restore(trashName: string, name: string): Promise<void>;
  /** 휴지통에서 아주 지운다(없으면 그대로). */
  purge(trashName: string): Promise<void>;
  readManifest(): Promise<LibraryManifest>;
  writeManifest(m: LibraryManifest): Promise<void>;
}

/** 폴더 소스(웹 FSA · 데스크톱) — 칩 이름과 닿을 수 있는지. */
export interface FolderSource extends LibrarySource {
  readonly kind: "fsa" | "tauri";
  readonly label: string;
  access(): Promise<SourceAccess>;
  /** 다시 허용을 청한다 — 웹은 사용자 몸짓(클릭) 안에서 불러야 한다. */
  requestAccess(): Promise<SourceAccess>;
}

export const isFolderSource = (s: LibrarySource): s is FolderSource =>
  s.kind === "fsa" || s.kind === "tauri";

/** 사이드카를 읽는다 — 모양이 틀리면(손으로 고친 · 다른 앱) 빈 매니페스트로 보고, 맞는 항목만 남긴다. */
export function parseManifest(text: string | null): LibraryManifest {
  if (!text) return { version: 1, entries: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { version: 1, entries: [] };
  }
  const list = (raw as { entries?: unknown })?.entries;
  if (!Array.isArray(list)) return { version: 1, entries: [] };
  const entries = list.filter((e): e is LibraryEntry => {
    const x = e as Partial<LibraryEntry> | null;
    return (
      !!x &&
      typeof x.id === "string" &&
      typeof x.file === "string" &&
      typeof x.title === "string" &&
      typeof x.cover === "object" &&
      x.cover !== null &&
      typeof x.createdAt === "number" &&
      typeof x.updatedAt === "number"
    );
  });
  return { version: 1, entries };
}

/** 사이드카 글 — 사람이 열어 봐도 읽히게 들여 쓴다. 항목 순서는 만든 순(바뀔 때마다 줄이 뒤섞이지 않게). */
export function renderManifest(m: LibraryManifest): string {
  const entries = [...m.entries].sort(
    (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1),
  );
  return `${JSON.stringify({ version: 1, app: "zenyth", entries }, null, 1)}\n`;
}

/** 폴더 파일 이름이 라이브러리 항목이 될 수 있는가 — `.db` 만, 숨은 파일 · 임시 파일은 아니다. */
export const isDbFileName = (name: string) =>
  /\.db$/i.test(name) && !name.startsWith(".") && !name.startsWith("~");

/**
 * 엔진이 본 파일 곁에 두는 짝 — 저널(db6) · 저장 임시 파일(db1) · 번호 백업. 폴더 소스의 이름 바꾸기 · 휴지통이
 * 함께 옮긴다. `base` 의 짝이면 붙은 꼬리(`.journal` 따위)를 돌려준다.
 */
export function companionSuffix(base: string, name: string): string | null {
  if (
    name.length > base.length &&
    name.slice(0, base.length).toLowerCase() === base.toLowerCase()
  ) {
    const rest = name.slice(base.length);
    if (/^\.(journal|bak\d*|backup\d*|\d+)$/i.test(rest)) return rest;
  }
  return backupTail(base, name);
}

/**
 * 엔진 번호 백업 — DB1 `makeBackupFilePath` 는 `<줄기>_bak<N><확장자>` 로 쓴다(`연구.db` → `연구_bak1.db`). 꼬리는
 * `_bak1.db` 처럼 확장자까지이고, `withTail` 이 본 파일의 줄기에 붙인다.
 */
function backupTail(base: string, name: string): string | null {
  if (!/\.db$/i.test(base)) return null;
  const stem = base.slice(0, -3);
  if (name.length <= stem.length || name.slice(0, stem.length).toLowerCase() !== stem.toLowerCase())
    return null;
  const rest = name.slice(stem.length);
  return /^_bak\d+\.db$/i.test(rest) ? rest : null;
}

/** 짝 꼬리를 본 파일 이름에 붙인다 — `.journal` 따위는 뒤에, 번호 백업(`_bak1.db`)은 줄기에. */
export const withTail = (base: string, tail: string): string =>
  tail.startsWith("_") ? base.replace(/\.db$/i, "") + tail : base + tail;

/**
 * 폴더의 `.db` 가운데 엔진 번호 백업인가 — 본 파일(`<줄기>.db`)이 같은 폴더에 있을 때만. 그러면 항목이 아니라 그
 * 본 파일의 짝이다(이름 바꾸기 · 휴지통이 함께 옮긴다). `names` 는 폴더 파일 이름을 NFC · 소문자로.
 */
export function isEngineBackup(name: string, names: ReadonlySet<string>): boolean {
  const m = /^(.*)_bak\d+\.db$/i.exec(name);
  return !!m && names.has(`${m[1]}.db`.normalize("NFC").toLowerCase());
}
