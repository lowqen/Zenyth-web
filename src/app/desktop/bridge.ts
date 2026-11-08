import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { router } from "../routes";
import { RAIL } from "../destinations";
import { useThemeStore, type ThemeMode } from "../theme";
import { desktopAction, isWindows11 } from "./keys";
import { startUpdater } from "./updater";
import { openGameFile, saveGameFile } from "../../features/board/gameFileActions";
import { pickAndOpenGame } from "../commands/registry";
import { usePalette } from "../commands/palette";
import { runUserCommand, useUserCommands } from "../commands/userCommands";
import { hotkeyName } from "../commands/commandText";
import { useBoardNotice } from "../../features/board/boardNotice";
import { useSettingsStore } from "../../features/settings/settingsStore";
import { t } from "../../i18n/i18n";
import {
  startSettingsFileSync,
  type SettingsFiles,
} from "../../features/settings/settingsFileSync";

/**
 * 웹 ↔ Tauri 셸 연결(데스크톱 Z2). `main.tsx` 가 `IS_DESKTOP` 일 때만 동적 import 로 부른다 —
 * 웹 배포 번들은 이 파일과 `@tauri-apps/api` 를 받지 않는다.
 *
 * 셸 쪽 짝은 `desktop/src-tauri/src/main.rs`(파일 연결 · 단일 인스턴스 · 창 상태)다.
 */

/** 셸이 명령줄로 받은 기보 — main.rs `OpenFile` 과 같은 모양. */
interface OpenFileMsg {
  name: string;
  bytes: number[];
}

const OPEN_FILES_EVENT = "desktop://open-files";

export async function startDesktop(): Promise<void> {
  const win = getCurrentWindow();
  void markMica();
  window.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("keydown", (e) => void onKey(e), { capture: true });

  // Mica 색조 · 웹뷰의 prefers-color-scheme 를 앱 테마에 맞춘다(system 이면 운영체제를 따른다).
  const syncTheme = (mode: ThemeMode) => void win.setTheme(mode === "system" ? null : mode);
  syncTheme(useThemeStore.getState().mode);
  useThemeStore.subscribe((s, prev) => {
    if (s.mode !== prev.mode) syncTheme(s.mode);
  });

  // 창은 숨긴 채 뜬다(tauri.conf.json `visible: false`) — 첫 화면이 그려진 뒤에 보인다. 흰 창이나 투명 창이
  // 한 번 번쩍이지 않게. 웹이 여기까지 못 오면 셸이 5초 뒤에 스스로 보인다(main.rs SHOW_FALLBACK).
  requestAnimationFrame(() => requestAnimationFrame(() => void win.show()));

  // 파일 연결: 첫 실행의 파일은 가져오고, 이미 떠 있을 때 더블클릭한 파일은 이벤트로 받는다.
  // settings.txt · settings_dev.txt 직접 읽기 · 쓰기(데스크톱 Z4) — 셸 짝은 settings.rs.
  void startSettingsFileSync({
    read: (dir) => invoke<SettingsFiles>("settings_read", { dir }),
    write: (dir, main, dev) => invoke<void>("settings_write", { dir, main, dev }),
  });

  // 자동 업데이트(데스크톱 Z7) — 버전 · 포터블 여부를 읽고, 조금 뒤 조용히 한 번 확인한다.
  void startUpdater();

  await openAll(await invoke<OpenFileMsg[]>("take_open_files"));
  await listen<OpenFileMsg[]>(OPEN_FILES_EVENT, (e) => void openAll(e.payload));
}

/** 여러 개를 받으면 차례로 연다 — 마지막 것이 판에 남는다(탐색기에서 여러 개를 고른 경우). */
async function openAll(files: readonly OpenFileMsg[]): Promise<void> {
  for (const f of files) await openOne(new File([new Uint8Array(f.bytes)], f.name));
}

async function openOne(file: File): Promise<void> {
  const r = await openGameFile(file);
  if (r.ok && !router.state.location.pathname.startsWith("/board")) await router.navigate("/board");
  useBoardNotice.getState().show(r.text);
}

async function onKey(e: KeyboardEvent): Promise<void> {
  // 사용자 명령의 단축키를 받아 적는 중이면 그 칸이 키를 받는다 — 브라우저 기본 동작(새로 읽기 등)만 막는다.
  if (e.target instanceof Element && e.target.closest("[data-hotkey-capture]")) {
    if (desktopAction(e) || hotkeyName(e)) e.preventDefault();
    return;
  }
  const action = desktopAction(e);
  if (!action) return onUserHotkey(e);
  e.preventDefault();
  e.stopPropagation();
  if (e.repeat) return;
  switch (action.kind) {
    case "block":
      return;
    case "open":
      return pickAndOpenGame();
    case "palette":
      return usePalette.getState().setOpen(!usePalette.getState().open);
    case "save": {
      const name = await saveGameFile("psq");
      if (name) useBoardNotice.getState().show(`${t("저장했습니다")}: ${name}`);
      return;
    }
    case "rail": {
      // 보이는 레일과 같은 순서 — 고급 사용자 모드가 아니면 DB 가 빠진다(NavRail 과 같다).
      const pro = useSettingsStore.getState().showAdvanced;
      const dest = RAIL.filter((d) => pro || !d.pro)[action.index];
      if (dest) await router.navigate(dest.path);
      return;
    }
    case "fullscreen": {
      const win = getCurrentWindow();
      await win.setFullscreen(!(await win.isFullscreen()));
      return;
    }
  }
}

/** 사용자 명령에 묶은 단축키(Z4) — 앱 단축키(`desktopAction`)가 먼저다. */
async function onUserHotkey(e: KeyboardEvent): Promise<void> {
  const name = hotkeyName(e);
  if (!name) return;
  const cmd = useUserCommands.getState().list.find((c) => c.hotkey === name);
  if (!cmd) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.repeat) return;
  const why = await runUserCommand(cmd);
  if (why) useBoardNotice.getState().show(why);
}

/** 브라우저의 오른쪽 클릭 메뉴(뒤로 · 새로 고침 · 인쇄)는 앱에 맞지 않는다 — 글을 고르거나 쓰는 곳만 남긴다. */
function onContextMenu(e: MouseEvent): void {
  const el = e.target instanceof Element ? e.target : null;
  if (el?.closest("input, textarea, [contenteditable='true']")) return;
  if (window.getSelection()?.toString()) return;
  e.preventDefault();
}

/** Windows 11 이면 `data-mica` — 타이틀바가 반투명 크롬(`--c-chrome`)이 되고 그 뒤로 Mica 가 비친다. */
async function markMica(): Promise<void> {
  const uad = (
    navigator as Navigator & {
      userAgentData?: {
        platform: string;
        getHighEntropyValues: (hints: string[]) => Promise<{ platformVersion?: string }>;
      };
    }
  ).userAgentData;
  if (!uad) return;
  try {
    const { platformVersion = "" } = await uad.getHighEntropyValues(["platformVersion"]);
    if (isWindows11(uad.platform, platformVersion)) document.documentElement.dataset.mica = "";
  } catch {
    /* 판정 못 하면 불투명 면 그대로 — 안전한 쪽 */
  }
}
