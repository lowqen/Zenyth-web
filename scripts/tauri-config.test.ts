import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { siteHeaders } from "./headers.ts";
import { GAME_FILE_FORMATS } from "../src/core/model/game-file.ts";

/**
 * 데스크톱 셸(desktop/src-tauri) 설정이 웹의 원본과 어긋나지 않는가 — 데스크톱 Z2.
 *
 * Tauri 는 `public/_headers` 를 읽지 못하므로 tauri.conf.json 에 같은 정책을 손으로 적는다. 손으로 적은
 * 두 벌은 반드시 어긋나므로(headers.ts 머리말의 교훈) 여기서 대조한다. 셸이 다른 것은 하나뿐이다:
 * IPC 가 `ipc:`/`ipc.localhost` 로 가므로 connect-src 에 그것을 더한다.
 */
const conf = JSON.parse(
  readFileSync(new URL("../desktop/src-tauri/tauri.conf.json", import.meta.url), "utf8"),
) as {
  app: {
    windows: { label: string; dragDropEnabled?: boolean; decorations?: boolean }[];
    security: { csp: string; headers: Record<string, string> };
  };
  version: string;
  bundle: {
    fileAssociations: { ext: string[] }[];
    createUpdaterArtifacts?: boolean;
    resources?: Record<string, string>;
  };
  plugins?: { updater?: { pubkey: string; endpoints: string[] } };
};
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const mainRs = read("../desktop/src-tauri/src/main.rs");
const engineRs = read("../desktop/src-tauri/src/engine.rs");
const cargoToml = read("../desktop/src-tauri/Cargo.toml");
const desktopYml = read("../.github/workflows/desktop.yml");
const aboutPanel = read("../src/features/settings/AboutPanel.tsx");
const capability = JSON.parse(read("../desktop/src-tauri/capabilities/default.json")) as {
  permissions: string[];
};
const site = siteHeaders();

const IPC_SOURCES = ["ipc:", "http://ipc.localhost", "https://ipc.localhost"];

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map(([name, ...values]) => [name!, values]),
  );
}

describe("tauri.conf.json ↔ public/_headers (데스크톱 Z2)", () => {
  it("격리 · 보안 헤더가 배포와 같다 — 멀티스레드 엔진(SharedArrayBuffer)이 셸에서도 열린다", () => {
    for (const name of [
      "Cross-Origin-Opener-Policy",
      "Cross-Origin-Embedder-Policy",
      "Cross-Origin-Resource-Policy",
      "X-Content-Type-Options",
      "Permissions-Policy",
    ])
      expect(conf.app.security.headers[name], name).toBe(site[name]);
  });

  it("CSP 는 배포와 같고, connect-src 에 IPC 출처만 더한다", () => {
    const web = directives(site["Content-Security-Policy"]!);
    const shell = directives(conf.app.security.csp);
    expect([...shell.keys()].sort()).toEqual([...web.keys()].sort());
    for (const [name, values] of web) {
      const want = name === "connect-src" ? [...values, ...IPC_SOURCES] : values;
      expect(shell.get(name), name).toEqual(want);
    }
  });

  it("HTML 끌어다 놓기를 웹에 남긴다 — 셸이 가로채면 기보 · .rif 놓기가 죽는다", () => {
    const main = conf.app.windows.find((w) => w.label === "main");
    expect(main?.dragDropEnabled).toBe(false);
    expect(main?.decorations).toBe(false);
  });

  it("파일 연결 · 셸이 읽는 확장자 = 웹이 여는 기보 형식", () => {
    const assoc = conf.bundle.fileAssociations.flatMap((a) => a.ext).sort();
    expect(assoc).toEqual([...GAME_FILE_FORMATS].sort());
    const rs = /const GAME_EXTS: \[&str; \d+\] = \[([^\]]*)\]/.exec(mainRs)?.[1] ?? "";
    expect([...rs.matchAll(/"([a-z]+)"/g)].map((m) => m[1]).sort()).toEqual(
      [...GAME_FILE_FORMATS].sort(),
    );
  });
});

describe("배포 구성 (데스크톱 Z7)", () => {
  it("셸 버전 한 벌 — tauri.conf.json = Cargo.toml(릴리스 태그 desktop-v<버전>)", () => {
    const cargo = /^version = "([^"]+)"/m.exec(cargoToml)?.[1];
    expect(conf.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(cargo).toBe(conf.version);
  });

  it("자동 업데이트: 서명 산출물 · 공개키 · 롤링 릴리스 주소 · 권한", () => {
    expect(conf.bundle.createUpdaterArtifacts).toBe(true);
    const up = conf.plugins?.updater;
    // minisign 공개키(base64) — 개인키는 저장소에 없다(시크릿).
    expect(atob(up?.pubkey ?? "")).toMatch(/^untrusted comment: minisign public key/);
    expect(up?.endpoints).toEqual([
      "https://github.com/lowqen/Zenyth-web/releases/download/desktop-latest/latest.json",
    ]);
    expect(desktopYml).toContain("gh release upload desktop-latest latest.json --clobber");
    expect(capability.permissions).toContain("updater:default");
    expect(mainRs).toContain("tauri_plugin_updater::Builder");
  });

  it("동봉 엔진: CI 가 싣는 변형 = 셸이 고르는 변형, 설치 폴더 engine/", () => {
    expect(conf.bundle.resources).toEqual({ "../engine-bundle/*": "engine/" });
    const shell = [...engineRs.matchAll(/"(pbrain-rapfi-windows-[a-z0-9]+\.exe)"/g)].map(
      (m) => m[1],
    );
    const variants = [...new Set(shell)].map((f) => /windows-([a-z0-9]+)\.exe/.exec(f!)![1]);
    expect(variants).toEqual(["avx512vnni", "avx512", "avxvnni", "avx2", "sse"]);
    expect(desktopYml).toContain(`pbrain-rapfi-windows-{${variants.join(",")}}.exe`);
  });

  it("동봉 엔진 판 = 정보 화면이 가리키는 대응 소스(GPL)", () => {
    const yml = /RAPFI_NATIVE_TAG: "(\d+)"/.exec(desktopYml)?.[1];
    const about = /const RAPFI_NATIVE_TAG = "(\d+)"/.exec(aboutPanel)?.[1];
    expect(yml).toBeTruthy();
    expect(about).toBe(yml);
    expect(desktopYml).toMatch(/RAPFI_NATIVE_SHA256: [0-9a-f]{64}\s*$/m);
  });
});
