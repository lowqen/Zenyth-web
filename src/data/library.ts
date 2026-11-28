import type { Transaction } from "dexie";
import type { DbStats } from "../core/database/yxdbindex";
import { t } from "../i18n/i18n";

/**
 * 라이브러리의 저장 모양(라이브러리 계획 §3 · L1) — Dexie v6 의 `librarySources` · `libraryMeta` 와
 * `dbfiles` 의 `lib/<id>` 줄. 옛 v3 의 `rapfi.db` 한 줄은 v6 로 올라올 때 첫 항목 «내 DB» 가 된다(`migrateToV6`).
 *
 * 브라우저 소스의 파일은 **Blob** 으로 둔다 — 브라우저가 디스크 쪽에 두므로 열람 · 통계 워커가 `stream()` 으로
 * 흘려 읽고, 힙에 통째 올리는 것은 엔진에 넣을 때 한 번뿐이다.
 */

export const BROWSER_SOURCE_ID = "browser";

/** 폴더 소스의 메타데이터 사이드카 — 폴더를 옮기거나 안드로이드에서 열어도 이름 · 커버가 따라간다(계획 §3). */
export const MANIFEST_FILE = "zenyth-library.json";
/** 웹 폴더(FSA)의 휴지통 — 폴더 안의 숨은 폴더. 데스크톱은 OS 휴지통이다. */
export const FOLDER_TRASH = ".zenyth-trash";

/** 브라우저 소스의 파일 이름 — 제목이 바뀌어도 그대로다. */
export const browserFileOf = (id: string) => `lib/${id}`;

/** db6 저널 — 엔진이 `<db>.journal` 로 쓴다. */
export const journalOf = (name: string) => `${name}.journal`;

/** v3 ~ v5 의 엔진 DB 한 벌(이관 전 이름). */
const LEGACY_DB = "rapfi.db";
const LEGACY_JOURNAL = journalOf(LEGACY_DB);

export type SourceKind = "browser" | "fsa" | "tauri";

export interface LibrarySourceRow {
  id: string;
  kind: SourceKind;
  /** 칩에 쓰는 이름(폴더 이름 따위). 브라우저 소스는 없다. */
  label?: string;
  /** FSA 폴더 핸들(L4). */
  handle?: unknown;
  /** Tauri 폴더 경로(L4). */
  path?: string;
  addedAt: number;
}

/** 크기 + 끝 4KB 의 FNV-1a 64(db6 저널 머리와 같은 방식) + 바꾼 시각. 앱 밖에서 이름이 바뀌어도 짝짓는다. */
export interface Fingerprint {
  size: number;
  mtime: number;
  /** 16자리 16진수. */
  tail: string;
}

export interface LibraryCover {
  mode: "auto" | "eclipse" | "opening";
  /** `mode === "opening"` 일 때 26주형 번호(0..25). */
  opening?: number;
  /** «일식» 커버의 무늬. */
  seed: number;
}

export interface LibraryEntry {
  /** UUID — 파일 이름이 바뀌어도 그대로. */
  id: string;
  /** 소스 기준 상대 이름. 브라우저 소스는 `lib/<id>`. */
  file: string;
  title: string;
  cover: LibraryCover;
  /** 본 파일의 정체. 파일이 아직 없으면(새 DB, 저장 전) 없다. */
  fingerprint?: Fingerprint;
  /** 지금 `fingerprint` 에서 센 통계 — 본 파일이 바뀌면 지운다. */
  stats?: DbStats;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt?: number;
  /** 휴지통에 넣은 시각(브라우저 소스는 앱 안 30일). */
  trashedAt?: number;
  /** 휴지통 속 이름(소스가 정한다 — 되돌리기 · 완전 삭제에 쓴다). 없으면 브라우저 소스의 `.trash/<file>`. */
  trashFile?: string;
  /** 폴더에서 파일이 사라진 시각 — 앱 밖에서 지웠거나 옮겼다. 정체로 다시 짝지으면 걷고, 30일 뒤 정리한다. */
  missingSince?: number;
  /** 바꾸려던 파일 이름 — 다른 프로그램이 파일을 쥐고 있어 미뤘다(제목은 이미 바뀌었다). */
  fileRenamePending?: string;
}

/** `libraryMeta` 한 줄 — 항목 + 어느 소스의 것인가. */
export interface LibraryMetaRow extends LibraryEntry {
  source: string;
}

/** 엔진 DB 파일 한 벌 — `lib/<id>`(+ `.journal`). 이관 전(v3 ~ v5)에는 `bytes: Uint8Array` 였다. */
export interface DbFileRow {
  name: string;
  data: Blob;
  savedAt: number;
}

// ── 정체(fingerprint) ─────────────────────────────────────────────────

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = (1n << 64n) - 1n;
export const TAIL_BYTES = 4096;

/** FNV-1a 64 — db6 `fnv1a` 와 같다. 4KB 에만 쓰므로 BigInt 로 충분하다. */
export function fnv1a64(bytes: Uint8Array): string {
  let h = FNV_OFFSET;
  for (const b of bytes) h = ((h ^ BigInt(b)) * FNV_PRIME) & MASK64;
  return h.toString(16).padStart(16, "0");
}

/** 이미 손에 든 바이트의 정체 — 동기(IndexedDB 트랜잭션 안에서 쓴다). */
export function fingerprintBytes(bytes: Uint8Array, mtime: number): Fingerprint {
  const tail = bytes.subarray(Math.max(0, bytes.byteLength - TAIL_BYTES));
  return { size: bytes.byteLength, mtime, tail: fnv1a64(tail) };
}

/** 파일의 정체 — 끝 4KB 만 읽는다. */
export async function fingerprintOf(file: Blob, mtime: number): Promise<Fingerprint> {
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - TAIL_BYTES)).arrayBuffer());
  return { size: file.size, mtime, tail: fnv1a64(tail) };
}

/** 같은 파일인가 — 바꾼 시각은 보지 않는다(복사 · 옮기기로 바뀐다). */
export const sameFingerprint = (a: Fingerprint | undefined, b: Fingerprint | undefined) =>
  !!a && !!b && a.size === b.size && a.tail === b.tail;

// ── 새 항목 ──────────────────────────────────────────────────────────

/** UUID v4 — `crypto.randomUUID` 는 보안 출처에서만 있으므로(LAN 의 http) 없으면 직접 만든다. */
export function newEntryId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const randomSeed = () => Math.floor(Math.random() * 0x7fffffff);

/**
 * 새 항목 — `file` 이 없으면 브라우저 소스의 `lib/<id>`. 커버는 기본 «일식»(빈 새 DB), 가져온 파일 · 폴더에서
 * 새로 찾은 파일은 `"auto"`(통계 전 · 자유룰이면 일식으로 보이다가 주형이 잡히면 그 주형 — 2026-11-23 결정).
 */
export function newEntry(
  source: string,
  title: string,
  {
    file,
    mode = "eclipse",
    now = Date.now(),
  }: { file?: string | undefined; mode?: LibraryCover["mode"]; now?: number } = {},
): LibraryMetaRow {
  const id = newEntryId();
  return {
    id,
    source,
    file: file ?? browserFileOf(id),
    title,
    cover: { mode, seed: randomSeed() },
    createdAt: now,
    updatedAt: now,
  };
}

/** 새 브라우저 소스 항목(파일 없이) — 커버는 «일식», 무늬는 무작위. */
export function newBrowserEntry(title: string, now = Date.now()): LibraryMetaRow {
  return newEntry(BROWSER_SOURCE_ID, title, { now });
}

/** 첫 항목의 이름 — 이관한 옛 DB 와 처음 붙인 빈 DB. */
export const defaultEntryTitle = () => t("내 DB");

// ── v6 이관 ──────────────────────────────────────────────────────────

/**
 * v5 → v6: 브라우저 소스 줄을 만들고, 옛 `rapfi.db`(+ `.journal`, `Uint8Array`)를 `lib/<id>` Blob 으로 옮겨
 * 첫 항목 «내 DB» 로 삼는다. 저널은 본 파일과 짝이라 함께 옮긴다(본 파일 없는 저널은 버린다 — 엔진도 버린다).
 *
 * **트랜잭션 안에서 IndexedDB 가 아닌 약속을 기다리지 않는다**(기다리면 트랜잭션이 저절로 끝난다) — 그래서
 * 정체는 손에 든 바이트로 동기로 센다.
 */
export async function migrateToV6(tx: Transaction): Promise<void> {
  const now = Date.now();
  const sources = tx.table<LibrarySourceRow, string>("librarySources");
  const meta = tx.table<LibraryMetaRow, string>("libraryMeta");
  const files = tx.table<
    { name: string; bytes?: Uint8Array; data?: Blob; savedAt: number },
    string
  >("dbfiles");
  await sources.put({ id: BROWSER_SOURCE_ID, kind: "browser", addedAt: now });
  const base = await files.get(LEGACY_DB);
  const journal = await files.get(LEGACY_JOURNAL);
  await files.bulkDelete([LEGACY_DB, LEGACY_JOURNAL]);
  if (!base?.bytes) return;
  const entry = newBrowserEntry(defaultEntryTitle(), base.savedAt);
  entry.fingerprint = fingerprintBytes(base.bytes, base.savedAt);
  entry.lastOpenedAt = now;
  await files.put({
    name: entry.file,
    data: new Blob([base.bytes as BlobPart]),
    savedAt: base.savedAt,
  });
  if (journal?.bytes)
    await files.put({
      name: journalOf(entry.file),
      data: new Blob([journal.bytes as BlobPart]),
      savedAt: journal.savedAt,
    });
  await meta.put(entry);
}
