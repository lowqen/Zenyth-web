import { create } from "zustand";

/**
 * «새로워진 점»(앱 `WhatsNew`)을 띄울지 — 전에 온 사람이 새 배포를 처음 열 때 한 번, 그리고 설정 ▸ 정보에서 언제든.
 *
 * **이 모듈은 `main.tsx` 의 맨 처음에 읽힌다.** 처음 온 사람인지는 «`rapfi.*` 저장 값이 하나도 없는가»로 가르는데,
 * 다른 스토어가 뜨면서 무엇이든 쓰기 전에 봐야 한다. 처음 온 사람에게는 견줄 «전»이 없으므로 띄우지 않고 이 판을
 * 본 것으로 적어 둔다(앱도 새로 설치하면 띄우지 않는다).
 *
 * 웹에는 첫 방문 환영 화면 · 둘러보기가 없다 — 사용자 결정(2026-11-02)으로 걷었다. 처음 온 사람은 곧바로 보드다.
 */

/**
 * 이 배포의 «새로워진 점» 번호(날짜). 사람에게 알릴 만한 배포에서만 올리고, `releaseNotes.ts` 의 글을
 * 같이 고친다 — 시험(`firstVisit.test.ts`)이 둘이 맞는지 본다.
 */
export const RELEASE = 20261101;
/** 화면에 보이는 판 이름. */
export const RELEASE_NAME = "2026.11";

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
    // 저장소를 못 쓰는 브라우저(사생활 보호 등) — 매번 «새로워진 점»이 뜨지 않게 처음 온 사람으로 본다.
    return false;
  }
}

/** 저장 값에서 «새로워진 점»을 띄울지 — 시험할 수 있게 저장소와 나눈다. */
export function decideWhatsNew(
  seen: string | null,
  stored: boolean,
): { show: boolean; writeSeen?: string } {
  if (!stored) return { show: false, writeSeen: String(RELEASE) }; // 처음 온 사람
  return { show: Number(seen ?? 0) < RELEASE };
}

const first = (() => {
  const d = decideWhatsNew(get(SEEN), anyStored());
  if (d.writeSeen) put(SEEN, d.writeSeen);
  // 걷은 환영 화면(2026-11-01 ~ 02)이 남긴 값 — 판정 뒤에 지운다(판정에서는 «전에 온 사람»의 표시로 쓰였다).
  try {
    localStorage.removeItem("rapfi.welcome");
  } catch {
    /* 저장소를 못 쓰면 남은 값도 없다 */
  }
  return d;
})();

interface FirstVisit {
  whatsNew: boolean;
  openWhatsNew: () => void;
  closeWhatsNew: () => void;
}

export const useFirstVisit = create<FirstVisit>((set) => ({
  whatsNew: first.show,
  openWhatsNew: () => set({ whatsNew: true }),
  closeWhatsNew: () => {
    put(SEEN, String(RELEASE));
    set({ whatsNew: false });
  },
}));
