import { create } from "zustand";

/**
 * 연구의 «실전 대국 데이터» 안내(Z7 — 앱 `GameDataPrompt`, R2)가 어떤 모양으로 뜨는가.
 *
 * 세 모양: 탭 맨 위의 카드(`GameDataCard`) · «나중에»로 접은 한 줄 배너 · 데이터 없이 오프닝이나 랭킹을
 * 처음 열 때 한 번 뜨는 시트. 수순 탭에는 없다(그 데이터를 쓰지 않는다).
 *
 * 웹은 RenjuNet 팩이 없을 때도 **내 기보**로 센다(`activePack`) — 그래도 «실전» 데이터는 없는 것이라
 * 안내는 RenjuNet 팩의 유무만 본다.
 */
export type GameDataForm = "none" | "card" | "banner";

/**
 * 지금 모양. `missing` 은 저장소를 읽기 전에는 null — 뜨자마자 깜빡이지 않게. 만드는 중 · 막 끝남 ·
 * 실패는 카드를 세운다(진행과 결과가 거기 산다). 접기는 기다리는 카드에만 듣는다.
 */
export function gameDataForm(
  missing: boolean | null,
  build: "idle" | "running" | "done" | "failed",
  collapsed: boolean,
): GameDataForm {
  if (build !== "idle") return "card";
  if (missing !== true) return "none";
  return collapsed ? "banner" : "card";
}

/** 시트: 한 번만, 그리고 없다는 것이 확실할 때만. */
export const gameDataSheetDue = (
  missing: boolean | null,
  build: "idle" | "running" | "done" | "failed",
  seen: boolean,
): boolean => missing === true && build === "idle" && !seen;

const COLLAPSED = "rapfi.dataPrompt.collapsed";
const SEEN = "rapfi.dataPrompt.sheet";

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function write(key: string, v: boolean) {
  try {
    localStorage.setItem(key, v ? "1" : "0");
  } catch {
    /* 이번 세션만 */
  }
}

interface PromptPrefs {
  collapsed: boolean;
  sheetSeen: boolean;
  setCollapsed: (v: boolean) => void;
  markSheetSeen: () => void;
}

/** 접음 · 시트 본 것 — 이 브라우저에 남는다(앱은 설치당). */
export const useGameDataPrefs = create<PromptPrefs>((set) => ({
  collapsed: read(COLLAPSED),
  sheetSeen: read(SEEN),
  setCollapsed: (collapsed) => {
    write(COLLAPSED, collapsed);
    set({ collapsed });
  },
  markSheetSeen: () => {
    write(SEEN, true);
    set({ sheetSeen: true });
  },
}));
