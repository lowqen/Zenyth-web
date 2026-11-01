import { describe, expect, it } from "vitest";
import { RELEASE, decideFirstVisit } from "./firstVisit";
import { RELEASE_NOTES } from "./releaseNotes";

/** 앱 `Onboarding.decide` · `WhatsNew.shouldShow` 와 같은 성질(Z8). */
describe("첫 방문", () => {
  it("처음 온 사람: 환영을 띄우고, 새로워진 점은 띄우지 않는다(견줄 «전»이 없다)", () => {
    expect(decideFirstVisit(null, null, false)).toEqual({
      welcome: "show",
      whatsNew: false,
      writeWelcome: "0",
      writeSeen: String(RELEASE),
    });
  });

  it("환영을 끝내기 전에 새로고침하면 다시 환영", () => {
    // 첫 판정이 rapfi.welcome = 0 과 rapfi.whatsnew 를 써 두었으므로 «저장 값 있음»이다.
    expect(decideFirstVisit("0", String(RELEASE), true).welcome).toBe("show");
  });

  it("전에 온 사람(이 기능 전부터): 환영은 없고, 새로워진 점을 한 번", () => {
    expect(decideFirstVisit(null, null, true)).toEqual({ welcome: "done", whatsNew: true });
  });

  it("본 판이 이 판이면 새로워진 점은 없다", () => {
    expect(decideFirstVisit("1", String(RELEASE), true).whatsNew).toBe(false);
    expect(decideFirstVisit("1", String(RELEASE - 1), true).whatsNew).toBe(true);
  });

  it("이 판의 번호와 «새로워진 점» 글이 짝이다 — 번호만 올리고 글을 잊지 않게", () => {
    expect(RELEASE_NOTES.release).toBe(RELEASE);
    expect(RELEASE_NOTES.groups.every((g) => g.items.length > 0)).toBe(true);
  });
});
