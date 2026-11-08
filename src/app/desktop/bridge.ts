import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { router } from "../routes";
import { RAIL } from "../destinations";
import { useThemeStore, type ThemeMode } from "../theme";
import { desktopAction, isWindows11 } from "./keys";
import { openGameFile, saveGameFile } from "../../features/board/gameFileActions";
import { useBoardNotice } from "../../features/board/boardNotice";
import { useSettingsStore } from "../../features/settings/settingsStore";
import { GAME_FILE_ACCEPT } from "../../core/model/game-file";
import { t } from "../../i18n/i18n";

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

function pickAndOpen(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = GAME_FILE_ACCEPT;
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void openOne(file);
  });
  input.click();
}

async function onKey(e: KeyboardEvent): Promise<void> {
  const action = desktopAction(e);
  if (!action) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.repeat) return;
  switch (action.kind) {
    case "block":
      return;
    case "open":
      return pickAndOpen();
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
