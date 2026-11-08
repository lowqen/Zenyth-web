import { afterEach, describe, expect, it, vi } from "vitest";
import { DESKTOP_DEFAULTS, render, specOf } from "../../core/settings/desktop-settings";
import {
  flushSettingsFile,
  resetSettingsFileForTest,
  startSettingsFileSync,
  useSettingsFile,
  type SettingsFilePort,
} from "./settingsFileSync";
import { useSettingsStore } from "./settingsStore";

/**
 * 데스크톱 Z4 — settings.txt 직접 읽기 · 쓰기. 셸 창구를 메모리 파일로 흉내 낸다.
 * 지키는 것: 뜰 때 파일 값이 웹에 들어온다 · 웹에서 바뀐 칸의 줄만 다시 쓴다 · 그 사이 다른 프로그램이
 * 웹이 모르는 칸을 고친 것은 지우지 않는다 · 바뀐 것이 없으면 쓰지 않는다.
 */

// 테마 스토어가 <html> 의 data-theme 를 만진다(27행 다크 모드) — 노드 환경엔 문서가 없다.
vi.stubGlobal("document", { documentElement: { dataset: {} } });

/** multiPv 는 settings.txt 몇 행인가 — 표가 곧 파일 배치다. */
const MULTI_PV_LINE = specOf("multiPv")!.line;
const LANGUAGE_LINE = specOf("language")!.line;

const crlf = (s: string) => s.replace(/\n/g, "\r\n");

function memoryPort(files: { main: string | null; dev: string | null }) {
  const writes: { main: string | null; dev: string | null }[] = [];
  const port: SettingsFilePort = {
    read: async () => ({ dir: "C:\\Yixin", ...files }),
    write: async (_dir, main, dev) => {
      writes.push({ main, dev });
      if (main !== null) files.main = main;
      if (dev !== null) files.dev = dev;
    },
  };
  return { port, files, writes };
}

const lineOf = (text: string | null, n: number) => text!.split("\r\n")[n - 1];

afterEach(() => {
  resetSettingsFileForTest();
  useSettingsStore.getState().reset();
});

describe("settings.txt 직접 맞추기", () => {
  it("뜰 때 파일의 값이 웹 설정이 된다", async () => {
    const main = crlf(render({ ...DESKTOP_DEFAULTS, multiPv: 7 }, "main"));
    const m = memoryPort({ main, dev: crlf(render(DESKTOP_DEFAULTS, "dev")) });

    await startSettingsFileSync(m.port);

    expect(useSettingsStore.getState().multiPv).toBe(7);
    expect(useSettingsFile.getState().resolvedDir).toBe("C:\\Yixin");
    expect(useSettingsFile.getState().error).toBeNull();
    // 읽기만으로는 쓰지 않는다.
    await flushSettingsFile();
    expect(m.writes).toEqual([]);
  });

  it("웹에서 바뀐 칸의 줄만 다시 쓰고, 그 사이 다른 프로그램이 고친 웹 밖 칸은 지킨다", async () => {
    const main0 = crlf(render(DESKTOP_DEFAULTS, "main"));
    const m = memoryPort({ main: main0, dev: crlf(render(DESKTOP_DEFAULTS, "dev")) });
    await startSettingsFileSync(m.port);

    // Yixin.exe 가 언어(2행 — 웹에 없는 칸)를 바꿔 저장했다.
    m.files.main = m.files.main!.replace(/^0\t;language/m, "3\t;language");
    useSettingsStore.getState().update({ multiPv: 5 });
    await flushSettingsFile();

    expect(m.writes).toHaveLength(1);
    expect(m.writes[0]!.dev).toBeNull(); // dev 파일은 바뀐 것이 없다
    const after = m.files.main!;
    expect(lineOf(after, LANGUAGE_LINE)).toBe("3\t;language (0: English, 1,2,...: custom)");
    expect(lineOf(after, MULTI_PV_LINE)).toMatch(/^5\t;default number of multi-pv/);
    const changed = after
      .split("\r\n")
      .flatMap((l, i) => (l !== main0.split("\r\n")[i] ? [i + 1] : []));
    expect(changed).toEqual([LANGUAGE_LINE, MULTI_PV_LINE]);
  });

  it("파일이 없으면 처음 바뀔 때 두 파일을 새로 만든다(CRLF)", async () => {
    const m = memoryPort({ main: null, dev: null });
    await startSettingsFileSync(m.port);
    expect(useSettingsFile.getState().status).toMatch(/파일이 없습니다/);

    useSettingsStore.getState().update({ multiPv: 4 });
    await flushSettingsFile();

    expect(m.files.main).toMatch(/\r\n/);
    expect(lineOf(m.files.main, MULTI_PV_LINE)).toMatch(/^4\t;/);
    expect(m.files.dev?.split("\r\n")).toHaveLength(21);
  });

  it("끄면 쓰지 않는다", async () => {
    const m = memoryPort({ main: crlf(render(DESKTOP_DEFAULTS, "main")), dev: null });
    await startSettingsFileSync(m.port);
    await useSettingsFile.getState().setEnabled(false);

    useSettingsStore.getState().update({ multiPv: 6 });
    await flushSettingsFile();

    expect(m.writes).toEqual([]);
  });

  it("읽기가 실패하면 까닭을 보이고 웹 설정은 그대로 둔다", async () => {
    const before = useSettingsStore.getState().multiPv;
    await startSettingsFileSync({
      read: async () => {
        throw new Error("폴더가 없습니다: D:\\없음");
      },
      write: async () => undefined,
    });
    expect(useSettingsFile.getState().error).toMatch(/폴더가 없습니다/);
    expect(useSettingsStore.getState().multiPv).toBe(before);
  });
});
