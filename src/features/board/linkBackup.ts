import { create } from "zustand";
import { useGameStore } from "./gameStore";
import { useBoardStore } from "./boardStore";
import { clearSlot, readSlot, writeSlot, type AutosaveState } from "../../data/games";
import { db as defaultDb, type RapfiDb } from "../../data/db";
import { sameMove, type Move } from "../../core/model/move";

/**
 * 국면 딥링크를 열기 직전에 두던 판 — 링크가 판을 덮어도 잃지 않게.
 *
 * 링크를 열면 그 국면이 지금 판이 되어 자동 저장 자리를 덮는다(`autosave.ts`). 그 전에
 * 두던 판이 있었으면 `beforeLink` 자리에 옮겨 두고, 보드 옆 칸에 「두던 판으로 돌아가기 ·
 * 버리기」를 띄운다. **사용자가 둘 중 하나를 고를 때까지 남는다** — 새로고침해도 다시
 * 묻는다. 보관만 하고 다시 꺼낼 길이 없으면 보관하지 않은 것과 같기 때문이다.
 *
 * 두던 판이 비었거나 링크와 같은 판이면 보관하지 않는다(물을 것이 없다).
 *
 * 라이브러리에서 DB 를 열어 판이 그 DB 의 국면으로 바뀔 때(`keepBoardBefore`)도 같은 자리 · 같은 안내를 쓴다.
 * 링크나 라이브러리가 올린 국면을 손대지 않은 채 또 열면 그 국면은 보관하지 않는다 — 먼저 보관한 «두던 판» 이
 * 덮이지 않게(올린 국면은 다시 열면 되므로).
 */
interface LinkBackupState {
  backup: AutosaveState | null;
  /** 무엇이 판을 덮었는가 — 안내 글이 다르다. */
  from: "link" | "library";
  /** 두던 판을 다시 올린다. 지금 판(링크의 국면)은 그 판으로 바뀐다. */
  restore: () => Promise<void>;
  /** 보관한 판을 버린다. */
  discard: () => Promise<void>;
}

let db: RapfiDb | null = null;
/** 링크 · 라이브러리가 마지막으로 올린 국면 — 손대지 않았으면 다시 보관하지 않는다. */
let placed: readonly Move[] | null = null;

export const useLinkBackup = create<LinkBackupState>((set, get) => ({
  backup: null,
  from: "link",
  restore: async () => {
    const b = get().backup;
    if (!b) return;
    placed = null;
    useGameStore.getState().loadMoves(b.moves, {
      future: b.future,
      name: b.name || null,
      what: `${get().from === "library" ? "DB" : "링크"}를 열기 전 판으로: ${b.moves.length}수`,
    });
    set({ backup: null });
    if (db) await clearSlot(db, "beforeLink").catch(() => {});
  },
  discard: async () => {
    set({ backup: null });
    if (db) await clearSlot(db, "beforeLink").catch(() => {});
  },
}));

const sameLine = (a: AutosaveState, link: readonly { x: number; y: number }[]) =>
  a.future.length === 0 &&
  a.moves.length === link.length &&
  a.moves.every((m, i) => sameMove(m, link[i]!));

/**
 * 라이브러리가 판을 `target` 으로 갈아 끼우기 직전 — 지금 판을 «두던 판» 으로 보관하고 안내를 띄운다.
 * 판이 비었거나 `target` 과 같거나, 앞서 올린 국면을 손대지 않았으면 보관하지 않는다. 판은 부르는 순간
 * (첫 `await` 전)에 읽으므로 기다리지 않고 곧바로 `loadMoves` 해도 된다.
 */
export async function keepBoardBefore(target: readonly Move[]): Promise<void> {
  const b = useBoardStore.getState();
  const cur: AutosaveState = {
    name: useGameStore.getState().gameName ?? "",
    size: b.render.size,
    moves: b.render.stones,
    future: b.future,
  };
  const untouched = placed !== null && sameLine(cur, placed);
  placed = target;
  if (cur.moves.length + cur.future.length === 0 || sameLine(cur, target) || untouched) return;
  const kept: AutosaveState = { ...cur, from: "library" };
  useLinkBackup.setState({ backup: kept, from: "library" });
  const d = db ?? defaultDb();
  if (d) await writeSlot(d, "beforeLink", kept).catch(() => {});
}

/**
 * 링크를 열 때 — 덮이기 전의 자동 저장을 `beforeLink` 로 옮긴다. 링크가 없을 때 —
 * 지난번에 고르지 않고 떠난 보관판이 있으면 다시 띄운다.
 */
export async function prepareLinkBackup(
  d: RapfiDb,
  link: readonly { x: number; y: number }[] | null,
): Promise<void> {
  db = d;
  try {
    if (link) {
      placed = link;
      const old = await readSlot(d, "autosave");
      if (old && old.moves.length + old.future.length > 0 && !sameLine(old, link)) {
        await writeSlot(d, "beforeLink", old);
        useLinkBackup.setState({ backup: old, from: "link" });
        return;
      }
    }
    const kept = await readSlot(d, "beforeLink");
    if (kept) useLinkBackup.setState({ backup: kept, from: kept.from ?? "link" });
  } catch {
    /* 저장소가 막혀도 링크는 연다 — 보관만 못 할 뿐이다 */
  }
}
