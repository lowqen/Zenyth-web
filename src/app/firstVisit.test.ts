import { describe, expect, it } from "vitest";
import { RELEASE, decideWhatsNew } from "./firstVisit";
import { RELEASE_NOTES } from "./releaseNotes";

/** 앱 `WhatsNew.shouldShow` 와 같은 성질. */
describe("새로워진 점", () => {
  it("처음 온 사람에게는 띄우지 않고, 이 판을 본 것으로 적는다(견줄 «전»이 없다)", () => {
    expect(decideWhatsNew(null, false)).toEqual({ show: false, writeSeen: String(RELEASE) });
  });

  it("전에 온 사람(이 기능 전부터)에게는 한 번", () => {
    expect(decideWhatsNew(null, true)).toEqual({ show: true });
  });

  it("본 판이 이 판이면 없다", () => {
    expect(decideWhatsNew(String(RELEASE), true).show).toBe(false);
    expect(decideWhatsNew(String(RELEASE - 1), true).show).toBe(true);
  });

  it("이 판의 번호와 «새로워진 점» 글이 짝이다 — 번호만 올리고 글을 잊지 않게", () => {
    expect(RELEASE_NOTES.release).toBe(RELEASE);
    expect(RELEASE_NOTES.groups.every((g) => g.items.length > 0)).toBe(true);
  });
});
