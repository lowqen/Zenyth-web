import { create } from "zustand";
import { useThemeStore } from "../../app/theme";
import {
  overlayChanged,
  overlayWeb,
  webFromDesktop,
  type WebSettings,
} from "../../core/settings/desktop-bridge";
import { parse, renderOver, type DesktopValues } from "../../core/settings/desktop-settings";
import { useBoardStore } from "../board/boardStore";
import { useGameStore } from "../board/gameStore";
import { useClockStore } from "../board/clockStore";
import { useDbStore } from "../database/dbStore";
import { useProveStore } from "../research/prove/proveStore";
import { useReviewStore } from "../research/review/reviewStore";
import { applyWeb, loadDesktopBase, readWeb, saveDesktopBase } from "./desktopBridge";
import { useSettingsStore } from "./settingsStore";
import { t } from "../../i18n/i18n";

/**
 * 데스크톱 Z4 — `settings.txt` · `settings_dev.txt` 를 **직접** 읽고 쓴다(웹의 가져오기 · 내보내기 대신).
 *
 *   - 앱이 뜰 때 폴더의 두 파일을 읽어 웹 값에 넣는다(가져오기와 같은 길 — `webFromDesktop` → `applyWeb`).
 *   - 웹에서 설정이 바뀌면 1초 뒤 디스크의 파일을 **다시 읽고**, 웹에서 바뀐 칸만 얹어(`overlayChanged`)
 *     원본 줄을 최대한 지키며 다시 쓴다(`renderOver` — 위치 규약 · 끝에만 추가, 핸드북 규칙 4).
 *     그 사이 Yixin.exe 가 웹이 모르는 칸을 고쳤어도 지워지지 않는다.
 *
 * 셸 쪽 창구는 `SettingsFilePort` 로만 들어온다(`app/desktop/bridge.ts` 가 `settings_read` · `settings_write`
 * 로 잇는다). 웹 배포에서는 창구가 없으므로 아무것도 하지 않는다.
 */

export interface SettingsFiles {
  /** 실제로 쓴 폴더(절대 경로). */
  dir: string;
  main: string | null;
  dev: string | null;
}

export interface SettingsFilePort {
  read(dir: string): Promise<SettingsFiles>;
  /** `null` 인 파일은 건드리지 않는다. */
  write(dir: string, main: string | null, dev: string | null): Promise<void>;
}

const PREF_KEY = "zenyth.desktop.settingsFile";
const WRITE_DELAY_MS = 1_000;

interface Prefs {
  /** 파일과 맞추는가. 끄면 웹 저장소 값만 쓴다(가져오기 · 내보내기는 그대로). */
  enabled: boolean;
  /** 두 파일이 있는 폴더 — 비우면 앱(셸 실행 파일) 폴더. */
  dir: string;
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    const p = raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
    return {
      enabled: typeof p.enabled === "boolean" ? p.enabled : true,
      dir: typeof p.dir === "string" ? p.dir : "",
    };
  } catch {
    return { enabled: true, dir: "" };
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    /* 이번 세션만 */
  }
}

interface SettingsFileState extends Prefs {
  /** 셸 창구가 있는가(데스크톱). */
  available: boolean;
  /** 셸이 알려 준 실제 폴더. */
  resolvedDir: string | null;
  /** 마지막으로 읽거나 쓴 결과 — 사람이 읽을 한 줄. */
  status: string | null;
  error: string | null;
  setEnabled: (on: boolean) => Promise<void>;
  setDir: (dir: string) => Promise<void>;
  /** 디스크에서 다시 읽어 웹 값에 넣는다. */
  reload: () => Promise<void>;
}

let port: SettingsFilePort | null = null;
/** 마지막으로 파일과 맞춘 웹 값 — 다음 쓰기에서 «무엇이 바뀌었나»의 기준. */
let synced: WebSettings | null = null;
/** 파일 값을 웹에 넣는 동안 — 그 사이의 스토어 변화는 쓰기로 되돌아가지 않는다. */
let applying = false;
let timer: ReturnType<typeof setTimeout> | null = null;
/** 읽기 · 쓰기를 한 줄로 — 겹치면 앞의 쓰기가 뒤의 읽기를 덮을 수 있다. */
let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(f: () => Promise<T>): Promise<T> => {
  const p = chain.then(f, f);
  chain = p.catch(() => undefined);
  return p;
};

const sameWeb = (a: WebSettings | null, b: WebSettings) =>
  a !== null && JSON.stringify(a) === JSON.stringify(b);

const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));
const stamp = () => new Date().toLocaleTimeString();

function parseFiles(f: SettingsFiles, base: DesktopValues): DesktopValues {
  let v = base;
  if (f.main !== null) v = parse(f.main, "main", v);
  if (f.dev !== null) v = parse(f.dev, "dev", v);
  return v;
}

export const useSettingsFile = create<SettingsFileState>((set, get) => {
  const load = () =>
    serial(async () => {
      if (!port) return;
      try {
        const f = await port.read(get().dir);
        set({ resolvedDir: f.dir });
        if (f.main === null && f.dev === null) {
          // 파일이 없다 — 지금 웹 값이 기준이다. 처음 바뀔 때 두 파일을 새로 만든다.
          synced = readWeb();
          set({ status: t("파일이 없습니다. 설정을 바꾸면 새로 만듭니다"), error: null });
          return;
        }
        const values = parseFiles(f, loadDesktopBase());
        saveDesktopBase(values);
        const { web, notes } = webFromDesktop(values, readWeb());
        applying = true;
        try {
          notes.push(...(await applyWeb(web)));
        } finally {
          applying = false;
        }
        synced = readWeb();
        set({
          status: [t("읽음 {time}", { time: stamp() }), ...notes].join("\n"),
          error: null,
        });
      } catch (e) {
        set({ error: t("설정 파일을 읽지 못했습니다: {why}", { why: describe(e) }) });
      }
    });

  return {
    ...loadPrefs(),
    available: false,
    resolvedDir: null,
    status: null,
    error: null,
    setEnabled: async (enabled) => {
      set({ enabled });
      savePrefs({ enabled, dir: get().dir });
      if (enabled) await load();
    },
    setDir: async (dir) => {
      const d = dir.trim();
      if (d === get().dir) return;
      set({ dir: d, resolvedDir: null });
      savePrefs({ enabled: get().enabled, dir: d });
      if (get().enabled) await load();
    },
    reload: load,
  };
});

/** 웹 값이 바뀌었으면 디스크를 다시 읽고 바뀐 칸만 얹어 쓴다. */
export function flushSettingsFile(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  return serial(async () => {
    const s = useSettingsFile.getState();
    if (!port || !s.enabled || applying) return;
    const web = readWeb();
    if (sameWeb(synced, web)) return;
    try {
      const disk = await port.read(s.dir);
      const base = parseFiles(disk, loadDesktopBase());
      // 새 파일이면 웹 값 전부, 있으면 웹에서 바뀐 칸만.
      const values =
        (disk.main === null && disk.dev === null) || !synced
          ? overlayWeb(base, web)
          : overlayChanged(base, synced, web);
      saveDesktopBase(values);
      const main = renderOver(disk.main, values, "main");
      const dev = renderOver(disk.dev, values, "dev");
      await port.write(disk.dir, main !== disk.main ? main : null, dev !== disk.dev ? dev : null);
      synced = web;
      useSettingsFile.setState({
        resolvedDir: disk.dir,
        status: t("저장함 {time}", { time: stamp() }),
        error: null,
      });
    } catch (e) {
      useSettingsFile.setState({
        error: t("설정 파일에 쓰지 못했습니다: {why}", { why: describe(e) }),
      });
    }
  });
}

function schedule() {
  if (applying || !port || !useSettingsFile.getState().enabled) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flushSettingsFile(), WRITE_DELAY_MS);
}

let unsubscribe: (() => void) | null = null;

/**
 * 셸 창구를 끼우고 첫 읽기를 한다(데스크톱 시작 때 한 번). 스토어 변화는 `readWeb` 이 보는 것만 —
 * 판 · 대국 스토어는 수마다 바뀌지만 쓰기 전에 웹 값을 비교하므로 실제로 쓰는 일은 설정이 바뀔 때뿐이다.
 */
export async function startSettingsFileSync(p: SettingsFilePort): Promise<void> {
  port = p;
  useSettingsFile.setState({ available: true });
  unsubscribe?.();
  const subs = [
    useSettingsStore.subscribe(schedule),
    useGameStore.subscribe(schedule),
    useBoardStore.subscribe(schedule),
    useThemeStore.subscribe(schedule),
    useReviewStore.subscribe(schedule),
    useProveStore.subscribe(schedule),
    useDbStore.subscribe(schedule),
    // 시계는 250ms 마다 흐른다 — 설정이 바뀔 때만 깨운다(아니면 미루기 타이머가 끝없이 밀린다).
    useClockStore.subscribe((s, p) => {
      if (s.settings !== p.settings) schedule();
    }),
  ];
  unsubscribe = () => subs.forEach((u) => u());
  if (useSettingsFile.getState().enabled) await useSettingsFile.getState().reload();
}

/** 시험 전용 — 창구와 기준을 비운다. */
export function resetSettingsFileForTest(): void {
  unsubscribe?.();
  unsubscribe = null;
  port = null;
  synced = null;
  applying = false;
  if (timer) clearTimeout(timer);
  timer = null;
  chain = Promise.resolve();
  useSettingsFile.setState({
    ...loadPrefs(),
    available: false,
    resolvedDir: null,
    status: null,
    error: null,
  });
}
