import { check, type Update } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { useBoardNotice } from "../../features/board/boardNotice";
import { t } from "../../i18n/i18n";
import { useUpdateStore } from "./updateStore";

/**
 * 자동 업데이트(데스크톱 Z7) — 셸 짝은 `Zenyth-desktop/src-tauri/src/main.rs`(`tauri-plugin-updater` · `is_portable`).
 * `bridge.ts` 가 셸 안에서만 불러온다 — 웹 번들은 이 파일과 `@tauri-apps/plugin-updater` 를 받지 않는다.
 *
 * 업데이트 정보는 GitHub 릴리스 `desktop-latest` 의 `latest.json`(lowqen/Zenyth-desktop 의 desktop.yml «릴리스» 잡이 올린다)이고, 설치
 * 파일의 서명은 tauri.conf.json 의 공개키로 셸이 검증한다. 개인키는 저장소에 없다(CI 시크릿).
 */

/** 기동 직후는 엔진 · 가중치 로딩과 겹친다 — 조금 뒤에 확인한다. */
const STARTUP_DELAY_MS = 20_000;

let pending: Update | null = null;

export async function startUpdater(): Promise<void> {
  const store = useUpdateStore.getState();
  try {
    const [version, portable] = await Promise.all([getVersion(), invoke<boolean>("is_portable")]);
    store.setInfo(version, portable);
  } catch {
    return; // 셸이 업데이터를 모르면(옛 셸) 조용히 접는다
  }
  window.setTimeout(() => void checkForUpdate(false), STARTUP_DELAY_MS);
}

/**
 * 새 버전을 확인한다. `manual` 이 아니면(기동 확인) 실패해도 말하지 않는다 — 오프라인이 흔하고, 그것이
 * 분석을 가로막을 일은 아니다. 새 버전이 있으면 그때만 판 위에 한 줄 알린다.
 */
export async function checkForUpdate(manual: boolean): Promise<void> {
  const { phase, setPhase, portable } = useUpdateStore.getState();
  if (phase.kind === "checking" || phase.kind === "downloading" || phase.kind === "installing") {
    return;
  }
  setPhase({ kind: "checking" });
  try {
    const update = await check();
    pending = update;
    if (!update) {
      setPhase(manual ? { kind: "latest" } : { kind: "idle" });
      return;
    }
    setPhase({ kind: "available", version: update.version, notes: update.body ?? "" });
    if (!manual) {
      useBoardNotice.getState().show(
        portable
          ? t("새 버전 {v} 이 나왔습니다. 포터블판은 릴리스에서 직접 받으세요", {
              v: update.version,
            })
          : t("새 버전 {v} 이 나왔습니다. 설정 ▸ 정보에서 설치합니다", { v: update.version }),
      );
    }
  } catch (e) {
    pending = null;
    setPhase(manual ? { kind: "error", message: errorText(e) } : { kind: "idle" });
  }
}

/** 받은 업데이트를 설치한다 — 설치판이 뜨면 앱은 끝난다(Windows). 포터블판은 부르지 않는다. */
export async function installUpdate(): Promise<void> {
  const update = pending;
  const { setPhase, portable } = useUpdateStore.getState();
  if (!update || portable) return;
  let done = 0;
  let total: number | null = null;
  setPhase({ kind: "downloading", done, total });
  try {
    await update.download((ev) => {
      if (ev.event === "Started") total = ev.data.contentLength ?? null;
      else if (ev.event === "Progress") done += ev.data.chunkLength;
      else return;
      setPhase({ kind: "downloading", done, total });
    });
    setPhase({ kind: "installing" });
    // 설치판이 뜨면 업데이터가 곧바로 프로세스를 끝낸다(Exit 갈고리 없음) — 그 전에 셸이 로컬 엔진에
    // DB 를 저장시키고 닫는다. 남은 엔진은 설치판이 덮어쓸 exe 를 잠근다.
    await invoke("engines_shutdown");
    await update.install();
  } catch (e) {
    setPhase({ kind: "error", message: errorText(e) });
  }
}

function errorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return t("업데이트 정보를 받지 못했습니다: {why}", { why: raw.slice(0, 200) });
}
