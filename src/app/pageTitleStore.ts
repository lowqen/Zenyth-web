import { create } from "zustand";

/** 큰 제목(`PageTitle`)이 화면에 보이는지 — 상단 바가 읽는다. */
interface PageTitleState {
  /** 큰 제목이 지금 화면에 보이는가 — 보이는 동안 상단 바는 제목을 감춘다. */
  showing: boolean;
  setShowing: (v: boolean) => void;
}

export const usePageTitle = create<PageTitleState>((set) => ({
  showing: false,
  setShowing: (showing) => set({ showing }),
}));
