import { describe, expect, it } from "vitest";
import { fileNameFor } from "./fileName";

describe("fileNameFor — 제목에서 파일 이름", () => {
  it("쓸 수 없는 문자와 제어 문자를 _ 로", () => {
    expect(fileNameFor('a<b>c:d"e/f\\g|h?i*j')).toBe("a_b_c_d_e_f_g_h_i_j.db");
    expect(fileNameFor("tab\there")).toBe("tab_here.db");
  });

  it("끝의 점 · 공백을 떼고, .db 는 하나만", () => {
    expect(fileNameFor("연구 . ")).toBe("연구.db");
    expect(fileNameFor("화월.db")).toBe("화월.db");
    expect(fileNameFor("화월.DB")).toBe("화월.db");
  });

  it("예약 이름은 확장자가 붙어도 뒤에 _", () => {
    expect(fileNameFor("CON")).toBe("CON_.db");
    expect(fileNameFor("com1")).toBe("com1_.db");
    expect(fileNameFor("lpt9.txt")).toBe("lpt9.txt_.db");
    expect(fileNameFor("CONSOLE")).toBe("CONSOLE.db");
  });

  it("빈 제목은 db", () => {
    expect(fileNameFor("   ")).toBe("db.db");
    expect(fileNameFor("...")).toBe("db.db");
  });

  it("NFC 로 맞춘다(macOS 의 풀어 쓴 한글)", () => {
    const nfd = "화월".normalize("NFD");
    expect(fileNameFor(nfd)).toBe("화월.db");
  });

  it("UTF-8 255바이트 안으로, 글자를 가르지 않는다", () => {
    const name = fileNameFor("가".repeat(200));
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(255);
    expect(name.endsWith(".db")).toBe(true);
    expect(name).toBe("가".repeat(84) + ".db");
    const emoji = fileNameFor("😀".repeat(100));
    expect(new TextEncoder().encode(emoji).length).toBeLessThanOrEqual(255);
    expect(emoji).not.toContain("�");
  });

  it("겹치면 (2), (3) — 대소문자만 다른 것도 겹침", () => {
    expect(fileNameFor("연구", ["연구.db"])).toBe("연구 (2).db");
    expect(fileNameFor("연구", ["연구.db", "연구 (2).db"])).toBe("연구 (3).db");
    expect(fileNameFor("Study", ["study.DB"])).toBe("Study (2).db");
  });
});
