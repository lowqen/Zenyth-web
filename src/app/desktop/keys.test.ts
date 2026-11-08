import { describe, expect, it } from "vitest";
import { desktopAction, isWindows11, type KeyLike } from "./keys";

const key = (k: string, mods: Partial<Omit<KeyLike, "key">> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe("데스크톱 단축키 (데스크톱 Z2)", () => {
  it("앱 동작 — 열기 · 저장 · 레일 · 전체 화면 · 명령 팔레트", () => {
    expect(desktopAction(key("o", { ctrlKey: true }))).toEqual({ kind: "open" });
    expect(desktopAction(key("O", { ctrlKey: true }))).toEqual({ kind: "open" });
    expect(desktopAction(key("s", { ctrlKey: true }))).toEqual({ kind: "save" });
    expect(desktopAction(key("1", { ctrlKey: true }))).toEqual({ kind: "rail", index: 0 });
    expect(desktopAction(key("6", { ctrlKey: true }))).toEqual({ kind: "rail", index: 5 });
    expect(desktopAction(key("F11"))).toEqual({ kind: "fullscreen" });
    expect(desktopAction(key("k", { ctrlKey: true }))).toEqual({ kind: "palette" });
    expect(desktopAction(key("P", { ctrlKey: true, shiftKey: true }))).toEqual({ kind: "palette" });
  });

  it("브라우저 단축키는 막는다 — 새로 읽기 · 인쇄 · 소스 · 내려받기 · 개발자 도구", () => {
    for (const k of [
      key("F5"),
      key("F12"),
      key("r", { ctrlKey: true }),
      key("R", { ctrlKey: true, shiftKey: true }),
      key("p", { ctrlKey: true }),
      key("u", { ctrlKey: true }),
      key("j", { ctrlKey: true }),
      key("I", { ctrlKey: true, shiftKey: true }),
    ])
      expect(desktopAction(k), k.key).toEqual({ kind: "block" });
  });

  it("나머지는 웹이 하던 대로 — 판 이동 키 · 복사 · 붙여넣기 · AltGr", () => {
    for (const k of [
      key("ArrowLeft"),
      key("ArrowRight"),
      key("Home"),
      key("c", { ctrlKey: true }),
      key("v", { ctrlKey: true }),
      key("z", { ctrlKey: true }),
      key("0", { ctrlKey: true }),
      key("o", { ctrlKey: true, altKey: true }), // AltGr = Ctrl+Alt
      key("s", { metaKey: true }),
      key("a"),
    ])
      expect(desktopAction(k), JSON.stringify(k)).toBeNull();
  });

  it("Windows 11 판정 — platformVersion 주 번호 13 이상", () => {
    expect(isWindows11("Windows", "15.0.0")).toBe(true);
    expect(isWindows11("Windows", "13.0.0")).toBe(true);
    expect(isWindows11("Windows", "10.0.0")).toBe(false); // Windows 10
    expect(isWindows11("Windows", "")).toBe(false);
    expect(isWindows11("macOS", "15.0.0")).toBe(false);
  });
});
