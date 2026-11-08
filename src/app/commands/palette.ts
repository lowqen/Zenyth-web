import { create } from "zustand";

/** 명령 팔레트가 열려 있는가(데스크톱 Z4) — Ctrl+K 가 여닫는다(`desktop/bridge.ts`). */
export const usePalette = create<{ open: boolean; setOpen: (v: boolean) => void }>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/** 고르기 순서: 이름이 그 글자로 시작 → 이름에 있음 → 묶음 · id 에 있음. 같은 순위는 원래 차례대로. */
export function rankEntries<T extends { title: string; group: string; key: string }>(
  entries: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...entries];
  const scored: [number, T][] = [];
  for (const e of entries) {
    const title = e.title.toLowerCase();
    const score = title.startsWith(q)
      ? 0
      : title.includes(q)
        ? 1
        : `${e.group} ${e.key}`.toLowerCase().includes(q)
          ? 2
          : -1;
    if (score >= 0) scored.push([score, e]);
  }
  return scored.sort((a, b) => a[0] - b[0]).map(([, e]) => e);
}
