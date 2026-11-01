import { create } from "zustand";

/**
 * 첫 방문 환영 · 새로워진 점 · 둘러보기(Z8 — 앱 `OnboardingGate` · `WhatsNew` · `TourScreen`)의 상태.
 *
 * **이 모듈은 `main.tsx` 의 맨 처음에 읽힌다.** 처음 온 사람인지는 «`rapfi.*` 저장 값이 하나도 없는가»로
 * 가르는데, 다른 스토어가 뜨면서 무엇이든 쓰기 전에 봐야 한다.
 *
 *  - 처음 온 사람: 환영 한 화면. 끝내기 전에 새로고침해도 다시 뜬다(`rapfi.welcome = 0`). 새로워진 점은
 *    띄우지 않는다 — 견줄 «전»이 없다(앱도 새로 설치하면 띄우지 않는다).
 *  - 전에 온 사람: 환영은 없다(앱도 업데이트는 설정을 다시 묻지 않는다). 본 «새로워진 점»이 이 배포보다
 *    옛것이면 한 번 띄운다.
 *
 * 둘러보기는 스스로 뜨지 않는다 — 설정 ▸ 정보에서 연다(앱과 같다).
 */

/**
 * 이 배포의 «새로워진 점» 번호(날짜). 사람에게 알릴 만한 배포에서만 올리고, `releaseNotes.ts` 의 글을
 * 같이 고친다 — 시험(`firstVisit.test.ts`)이 둘이 맞는지 본다.
 */
export const RELEASE = 20261101;
/** 화면에 보이는 판 이름. */
export const RELEASE_NAME = "2026.11";

const WELCOME = "rapfi.welcome";
const SEEN = "rapfi.whatsnew";

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function put(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 이번 방문만 */
  }
}
function anyStored(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++)
      if (localStorage.key(i)?.startsWith("rapfi.")) return true;
    return false;
  } catch {
    // 저장소를 못 쓰는 브라우저(사생활 보호 등) — 매번 처음 온 사람이 되지 않게 «전에 온 사람»으로.
    return true;
  }
}

/** 저장 값에서 무엇을 띄울지 — 시험할 수 있게 저장소와 나눈다. */
export function decideFirstVisit(
  welcome: string | null,
  seen: string | null,
  stored: boolean,
): { welcome: "show" | "done"; whatsNew: boolean; writeWelcome?: string; writeSeen?: string } {
  if (welcome === null && !stored) {
    // 처음 온 사람
    return { welcome: "show", whatsNew: false, writeWelcome: "0", writeSeen: String(RELEASE) };
  }
  if (welcome === "0") return { welcome: "show", whatsNew: false };
  return { welcome: "done", whatsNew: Number(seen ?? 0) < RELEASE };
}

const first = (() => {
  const d = decideFirstVisit(get(WELCOME), get(SEEN), anyStored());
  if (d.writeWelcome) put(WELCOME, d.writeWelcome);
  if (d.writeSeen) put(SEEN, d.writeSeen);
  return d;
})();

interface FirstVisit {
  /** 환영을 마쳤는가 — 마치기 전에는 엔진을 띄우지 않는다(앱: 설정이 셸을 대신한다). */
  welcomed: boolean;
  whatsNew: boolean;
  tour: boolean;
  finishWelcome: () => void;
  openWhatsNew: () => void;
  closeWhatsNew: () => void;
  openTour: () => void;
  closeTour: () => void;
}

export const useFirstVisit = create<FirstVisit>((set) => ({
  welcomed: first.welcome === "done",
  whatsNew: first.whatsNew,
  tour: false,
  finishWelcome: () => {
    put(WELCOME, "1");
    set({ welcomed: true });
  },
  openWhatsNew: () => set({ whatsNew: true }),
  closeWhatsNew: () => {
    put(SEEN, String(RELEASE));
    set({ whatsNew: false });
  },
  openTour: () => set({ tour: true }),
  closeTour: () => set({ tour: false }),
}));
