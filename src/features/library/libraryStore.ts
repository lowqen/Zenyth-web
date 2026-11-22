import { create } from "zustand";
import { YxdbCancelled } from "../../core/database/yxdbfile";
import type { DbStats, ScanPhase, ScanResult } from "../../core/database/yxdbindex";
import { decodeKey, hexToKey } from "../../core/database/yxdbkey";
import { representative } from "../../core/opening/opening26";
import type { Move } from "../../core/model/move";
import { db } from "../../data/db";
import {
  fingerprintOf,
  journalOf,
  sameFingerprint,
  type LibraryCover,
  type LibraryMetaRow,
} from "../../data/library";
import { t } from "../../i18n/i18n";
import { useGameStore } from "../board/gameStore";
import { JOURNAL_HEADER, useDbStore } from "../database/dbStore";
import { browserSource } from "./browserSource";
import {
  createEntry,
  getEntry,
  listEntries,
  listTrashed,
  purgeEntry,
  readActiveId,
  restoreEntry,
  trashEntry,
  updateEntry,
} from "./library";
import { scanLibraryFile, type LibraryScan } from "./libraryWorker";

/**
 * 라이브러리 화면의 상태(라이브러리 계획 §6 · L2) — 항목 목록 · 파일 크기 · 통계 세기 · 휴지통, 그리고 «열기» 동선.
 *
 * 통계는 워커(`scanLibraryFile`)가 하나씩 센다. 정체(`fingerprint`)가 같으면 다시 세지 않고(§3), 세는 동안 파일이
 * 바뀌었으면(저장) 결과를 버리고 다음 차례에 다시 센다. 붙은 DB 는 **저장된 파일**을 센다 — 엔진 메모리의 저장 안 된
 * 변경은 다음 저장 뒤에 들어온다.
 */

export interface ScanState {
  id: string;
  phase: ScanPhase;
  fraction: number;
}

/** 색인을 건너뛴 까닭 — 상세가 한 줄로 말한다. */
export type ScanNote = "memory" | "alloc" | "unordered" | "error";

export type LibrarySort = "recent" | "name" | "size";

interface LibraryState {
  loaded: boolean;
  entries: LibraryMetaRow[];
  trashed: LibraryMetaRow[];
  /** 항목 id → 본 파일 + 저널 바이트(파일이 없으면 0). */
  sizes: Record<string, number>;
  scan: ScanState | null;
  /** 항목 id → 색인을 건너뛴 까닭(이번 세션). */
  notes: Record<string, ScanNote>;
  /** 마지막에 지운 항목 — 10초 되돌리기. */
  undo: { id: string; title: string; at: number } | null;

  load: () => Promise<void>;
  create: (title: string) => Promise<LibraryMetaRow | null>;
  importFile: (file: File) => Promise<string | null>;
  rename: (id: string, title: string) => Promise<void>;
  setCover: (id: string, cover: LibraryCover) => Promise<void>;
  trash: (id: string) => Promise<string | null>;
  restore: (id: string) => Promise<void>;
  purge: (id: string) => Promise<void>;
  exportFile: (id: string) => Promise<{ file: Blob; name: string } | { error: string }>;
  /** 이 DB 를 붙이고 국면을 연다 — `moves === null` 이면 판은 그대로, `"edit"` 는 편집기로. 오류 글 또는 null. */
  open: (id: string, moves: readonly Move[] | null) => Promise<string | null>;
  cancelScan: () => void;
  /** 세지 못한 항목을 다시 센다. */
  rescan: (id: string) => void;
}

let current: LibraryScan | null = null;
let pumping = false;

async function fileSize(file: string): Promise<number> {
  const [base, journal] = await Promise.all([
    browserSource.open(file),
    browserSource.open(journalOf(file)),
  ]);
  return (base?.size ?? 0) + (base ? (journal?.size ?? 0) : 0);
}

/** 쓰기 전에 — 처음이면 영속 저장을 청하고(지워지지 않게), 남은 자리가 모자라면 까닭. */
async function roomFor(bytes: number): Promise<string | null> {
  const sm = typeof navigator !== "undefined" ? navigator.storage : undefined;
  if (!sm) return null;
  try {
    if (sm.persisted && !(await sm.persisted())) await sm.persist?.();
    const est = await sm.estimate?.();
    if (est?.quota !== undefined && est.usage !== undefined && est.quota - est.usage < bytes * 1.1)
      return t("이 브라우저의 저장 공간이 모자랍니다");
  } catch {
    /* 묻지 못하면 써 본다 */
  }
  return null;
}

/** DB 국면 키 → 판에 놓을 수(흑 · 백을 번갈아). 판 크기가 다르거나 패스 칸이 있으면 null. */
export function movesOfKey(hex: string, size: number): Move[] | null {
  let k;
  try {
    k = decodeKey(hexToKey(hex));
  } catch {
    return null;
  }
  if (!k || k.pass || k.w !== size || k.h !== size) return null;
  const out: Move[] = [];
  for (let i = 0; i < k.black.length || i < k.white.length; i++) {
    if (i < k.black.length) out.push(k.black[i]!);
    if (i < k.white.length) out.push(k.white[i]!);
  }
  // 흑이 백보다 하나 많거나 같아야 둔 순서로 읽힌다.
  return k.black.length - k.white.length === 0 || k.black.length - k.white.length === 1
    ? out
    : null;
}

export const openingMoves = (index: number): Move[] => representative(index);

export const useLibraryStore = create<LibraryState>((set, get) => {
  const refresh = async () => {
    const [entries, trashed] = await Promise.all([listEntries(), listTrashed()]);
    const sizes: Record<string, number> = {};
    await Promise.all(entries.map(async (e) => void (sizes[e.id] = await fileSize(e.file))));
    set({ entries, trashed, sizes, loaded: true });
  };

  /** 통계가 없는(또는 정체가 바뀐) 항목을 하나씩 센다. 이미 돌고 있으면 그 줄이 이어서 집는다. */
  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      for (;;) {
        const next = get().entries.find(
          (e) => !e.stats && (get().sizes[e.id] ?? 0) > 0 && get().notes[e.id] !== "error",
        );
        if (!next) break;
        await scanOne(next);
      }
    } finally {
      pumping = false;
      set({ scan: null });
    }
  };

  const scanOne = async (e: LibraryMetaRow) => {
    const file = await browserSource.open(e.file);
    if (!file) return;
    const mtime = (await browserSource.mtime(e.file)) ?? e.updatedAt;
    const before = await fingerprintOf(file, mtime);
    set({ scan: { id: e.id, phase: "stats", fraction: 0 } });
    let last = 0;
    const job = scanLibraryFile(file, {
      onProgress: (p) => {
        // 진행은 10Hz 로 묶어 온다 — 화면은 1% 넘게 움직였을 때만 다시 그린다.
        if (Math.abs(p.fraction - last) < 0.01 && p.phase === get().scan?.phase) return;
        last = p.fraction;
        set({ scan: { id: e.id, phase: p.phase, fraction: p.fraction } });
      },
    });
    current = job;
    let result: ScanResult;
    try {
      result = await job.promise;
    } catch (err) {
      if (!(err instanceof YxdbCancelled)) set((s) => ({ notes: { ...s.notes, [e.id]: "error" } }));
      return;
    } finally {
      current = null;
    }
    // 세는 동안 저장이 있었으면 버린다 — 다음 차례가 새 파일로 다시 센다.
    const now = await getEntry(e.id);
    const after = await browserSource.open(e.file);
    if (!now || !after) return;
    const fp = await fingerprintOf(after, (await browserSource.mtime(e.file)) ?? mtime);
    if (!sameFingerprint(before, fp)) return;
    if (now.fingerprint && !sameFingerprint(now.fingerprint, fp)) return;
    const skipped = result.indexSkipped ?? result.openingsSkipped;
    if (skipped) set((s) => ({ notes: { ...s.notes, [e.id]: skipped } }));
    const stats: DbStats = result.stats;
    await updateEntry(e.id, { stats, fingerprint: now.fingerprint ?? fp });
    set((s) => ({
      entries: s.entries.map((x) =>
        x.id === e.id ? { ...x, stats, fingerprint: x.fingerprint ?? fp } : x,
      ),
    }));
  };

  return {
    loaded: false,
    entries: [],
    trashed: [],
    sizes: {},
    scan: null,
    notes: {},
    undo: null,

    load: async () => {
      if (!db()) return set({ loaded: true });
      await refresh();
      void pump();
    },

    create: async (title) => {
      const e = await createEntry(title, { select: false });
      await refresh();
      return e;
    },

    importFile: async (file) => {
      if (!db()) return t("이 브라우저는 저장소(IndexedDB)를 쓸 수 없습니다");
      const room = await roomFor(file.size);
      if (room) return room;
      const title = file.name.replace(/\.db$/i, "") || file.name;
      const e = await createEntry(title, { select: false });
      if (!e) return t("이 브라우저는 저장소(IndexedDB)를 쓸 수 없습니다");
      const savedAt = Date.now();
      await browserSource.writeAtomic([{ name: e.file, data: file }], savedAt);
      await updateEntry(e.id, {
        fingerprint: await fingerprintOf(file, savedAt),
        updatedAt: savedAt,
      });
      await refresh();
      void pump();
      return null;
    },

    rename: async (id, title) => {
      const clean = title.trim();
      if (!clean) return;
      await updateEntry(id, { title: clean, updatedAt: Date.now() });
      set((s) => ({ entries: s.entries.map((e) => (e.id === id ? { ...e, title: clean } : e)) }));
      if (useDbStore.getState().active?.id === id)
        useDbStore.setState({ active: { id, title: clean } });
    },

    setCover: async (id, cover) => {
      await updateEntry(id, { cover });
      set((s) => ({ entries: s.entries.map((e) => (e.id === id ? { ...e, cover } : e)) }));
    },

    trash: async (id) => {
      const dbs = useDbStore.getState();
      if (readActiveId() === id && dbs.status !== "off")
        return t("붙어 있는 DB 는 지울 수 없습니다. 다른 DB 를 먼저 여세요");
      const e = await getEntry(id);
      if (!e) return null;
      if (get().scan?.id === id) current?.cancel();
      await trashEntry(id);
      if (dbs.active?.id === id) await dbs.loadStored();
      set({ undo: { id, title: e.title, at: Date.now() } });
      await refresh();
      return null;
    },

    restore: async (id) => {
      await restoreEntry(id);
      if (get().undo?.id === id) set({ undo: null });
      await refresh();
      void pump();
    },

    purge: async (id) => {
      await purgeEntry(id);
      await refresh();
    },

    exportFile: async (id) => {
      const e = await getEntry(id);
      if (!e) return { error: t("라이브러리에 없는 DB 입니다") };
      const name = `${e.title}.db`;
      const dbs = useDbStore.getState();
      if (dbs.active?.id === id && dbs.status === "on") {
        const r = await dbs.exportFile();
        return "error" in r ? r : { file: r.file, name };
      }
      const [base, journal] = await Promise.all([
        browserSource.open(e.file),
        browserSource.open(journalOf(e.file)),
      ]);
      if (!base) return { error: t("저장된 DB 파일이 없습니다") };
      if (journal && journal.size > JOURNAL_HEADER)
        return { error: t("저널에 접히지 않은 변경이 있습니다. DB 를 붙인 뒤 내보내세요") };
      return { file: base, name };
    },

    open: async (id, moves) => {
      const dbs = useDbStore.getState();
      const err = await dbs.switchTo(id);
      if (err) return err;
      // 꺼져 있으면 켠다 — 엔진이 떠 있으면 곧 붙고, 아니면 뜰 때 붙는다(`wireDatabase`).
      if (!useDbStore.getState().settings.enabled) {
        const e2 = await useDbStore.getState().setSettings({ enabled: true });
        if (e2) return e2;
      }
      if (moves) {
        const title = (await getEntry(id))?.title ?? "";
        useGameStore.getState().loadMoves(moves, {
          name: title,
          what: t("라이브러리에서 {n}수 국면으로", { n: moves.length }),
        });
      }
      await refresh();
      return null;
    },

    cancelScan: () => current?.cancel(),

    rescan: (id) => {
      set((s) => {
        const notes = { ...s.notes };
        delete notes[id];
        return { notes };
      });
      void pump();
    },
  };
});
