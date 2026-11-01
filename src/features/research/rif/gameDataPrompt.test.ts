import { describe, expect, it } from "vitest";
import { gameDataForm, gameDataSheetDue } from "./gameDataPrompt";

/** 앱 `GameDataPrompt.form` · `sheet` 와 같은 규칙(Z7). */
describe("실전 대국 데이터 안내", () => {
  it("저장소를 읽기 전에는 아무것도 띄우지 않는다(깜빡임 없음)", () => {
    expect(gameDataForm(null, "idle", false)).toBe("none");
    expect(gameDataSheetDue(null, "idle", false)).toBe(false);
  });

  it("데이터가 있으면 없다", () => {
    expect(gameDataForm(false, "idle", false)).toBe("none");
    expect(gameDataForm(false, "idle", true)).toBe("none");
  });

  it("없으면 카드, 접었으면 배너", () => {
    expect(gameDataForm(true, "idle", false)).toBe("card");
    expect(gameDataForm(true, "idle", true)).toBe("banner");
  });

  it("만드는 중 · 막 끝남 · 실패는 접었어도, 데이터가 있어도 카드를 세운다", () => {
    for (const b of ["running", "done", "failed"] as const) {
      expect(gameDataForm(true, b, true)).toBe("card");
      expect(gameDataForm(false, b, false)).toBe("card");
    }
  });

  it("시트는 없다는 것이 확실하고 · 쉬고 있고 · 본 적 없을 때만", () => {
    expect(gameDataSheetDue(true, "idle", false)).toBe(true);
    expect(gameDataSheetDue(true, "idle", true)).toBe(false);
    expect(gameDataSheetDue(false, "idle", false)).toBe(false);
    expect(gameDataSheetDue(true, "running", false)).toBe(false);
  });
});
