import { RAIL } from "../destinations";
import { msg, t } from "../../i18n/i18n";
import { useGameStore, REVIEW_BUSY } from "../../features/board/gameStore";
import { useBoardStore } from "../../features/board/boardStore";
import { useBoardNotice } from "../../features/board/boardNotice";
import { useClockStore } from "../../features/board/clockStore";
import { openGameFile, saveGameFile } from "../../features/board/gameFileActions";
import { copyPositionString, saveBoardImage } from "../../features/board/shareActions";
import { copyPositionLink } from "../../features/board/positionLink";
import { useEngineStore } from "../../engine/engine-state";
import { useDbStore } from "../../features/database/dbStore";
import { useSettingsStore } from "../../features/settings/settingsStore";
import { GAME_FILE_ACCEPT } from "../../core/model/game-file";
import { PLAY_RULES, RULE_LABEL } from "../../core/model/rules";

/**
 * 앱 명령 — 명령 팔레트(Ctrl+K)와 사용자 명령(`@id` 단계)이 함께 부르는 목록(데스크톱 Z4). Yixin 의 툴바 단추 ·
 * 단축키 · `execute_command` 가 하던 일을 이 목록 하나가 맡는다.
 *
 * 화면의 단추와 **같은 길**을 걷는다(스토어의 같은 동작) — 팔레트에서 부른 「분석 시작」이 카드의 단추와 다르게
 * 움직이면 안 된다. 결과나 거절은 보드 알림으로 말한다.
 */

export interface AppCommand {
  id: string;
  /** 번역 열쇠(`msg`) — 그릴 때 `t()`. */
  title: string;
  group: string;
  /** 단축키 안내(있으면). */
  keys?: string;
  run: () => void | Promise<void>;
}

const notice = (text: string | null) => useBoardNotice.getState().show(text);
const game = () => useGameStore.getState();
const engine = () => useEngineStore.getState();

/**
 * 라우터는 부를 때 읽는다 — `routes` 는 `AppShell` 을 import 하고 `AppShell` 이 팔레트(→ 이 파일)를 그리므로,
 * 위에서 import 하면 모듈 순환에 걸린다.
 */
async function navigate(path: string) {
  const { router } = await import("../routes");
  if (path === "/board" && router.state.location.pathname.startsWith("/board")) return;
  await router.navigate(path);
}
const toBoard = () => navigate("/board");

function startAnalysis() {
  if (engine().owner) return notice(t(REVIEW_BUSY));
  void engine().analyze(useBoardStore.getState().placements());
}

function stopAnalysis() {
  const r = game().stopAnalysis({ playBest: useSettingsStore.getState().playBestOnStop });
  notice(r.kind === "rejected" ? t("정지했습니다: {why}", { why: r.reason }) : null);
}

/** 기보 열기 — 파일 고르기 창. 데스크톱 Ctrl+O 도 이 길이다. */
export function pickAndOpenGame(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = GAME_FILE_ACCEPT;
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    void openGameFile(file).then(async (r) => {
      if (r.ok) await toBoard();
      notice(r.text);
    });
  });
  input.click();
}

const G = {
  board: msg("판"),
  analysis: msg("분석"),
  game: msg("대국"),
  file: msg("파일"),
  engine: msg("엔진"),
  db: msg("DB"),
  nav: msg("이동"),
};

const BASE: readonly AppCommand[] = [
  { id: "board.new", title: msg("새 판"), group: G.board, run: () => game().newGame() },
  {
    id: "board.undo",
    title: msg("한 수 무르기"),
    group: G.board,
    keys: "←",
    run: () => game().undoMove(),
  },
  {
    id: "board.redo",
    title: msg("한 수 다시 두기"),
    group: G.board,
    keys: "→",
    run: () => game().redoMove(),
  },
  {
    id: "board.first",
    title: msg("처음으로"),
    group: G.board,
    keys: "Home",
    run: () => game().undoAll(),
  },
  {
    id: "board.last",
    title: msg("끝으로"),
    group: G.board,
    keys: "End",
    run: () => game().redoAll(),
  },
  {
    id: "board.mode-game",
    title: msg("대국 탭으로"),
    group: G.board,
    run: async () => {
      await toBoard();
      game().setMode("game");
    },
  },
  {
    id: "board.mode-analysis",
    title: msg("분석 탭으로"),
    group: G.board,
    run: async () => {
      await toBoard();
      game().setMode("analysis");
    },
  },

  { id: "analysis.start", title: msg("분석 시작"), group: G.analysis, run: startAnalysis },
  { id: "analysis.stop", title: msg("분석 정지"), group: G.analysis, run: stopAnalysis },
  {
    id: "analysis.toggle",
    title: msg("분석 켜기/끄기"),
    group: G.analysis,
    run: () => (engine().analyzing ? stopAnalysis() : startAnalysis()),
  },

  { id: "game.move-now", title: msg("지금 두기"), group: G.game, run: () => game().moveNow() },
  { id: "game.resign", title: msg("기권"), group: G.game, run: () => game().resign() },
  { id: "game.draw", title: msg("무승부 제안"), group: G.game, run: () => game().offerDraw() },
  {
    id: "game.clock",
    title: msg("대국 시계 켜기/끄기"),
    group: G.game,
    run: () => {
      const c = useClockStore.getState();
      c.setSettings({ enabled: !c.settings.enabled });
    },
  },
  ...PLAY_RULES.map((r): AppCommand => ({
    id: `game.rule.${r}`,
    title:
      r === "renju"
        ? msg("규칙: 렌주")
        : r === "freestyle"
          ? msg("규칙: 프리스타일")
          : msg("규칙: 스탠다드"),
    group: G.game,
    run: () => {
      game().setRule(r);
      const why = game().ruleNotice;
      notice(game().rule === r ? t("규칙: {rule}", { rule: RULE_LABEL[r] }) : why);
    },
  })),

  { id: "file.open", title: msg("기보 열기"), group: G.file, keys: "Ctrl+O", run: pickAndOpenGame },
  {
    id: "file.save",
    title: msg("기보 저장(.psq)"),
    group: G.file,
    keys: "Ctrl+S",
    run: async () => {
      const name = await saveGameFile("psq");
      if (name) notice(`${t("저장했습니다")}: ${name}`);
    },
  },
  {
    id: "file.copy-position",
    title: msg("국면 문자열 복사"),
    group: G.file,
    run: copyPositionString,
  },
  { id: "file.copy-link", title: msg("국면 링크 복사"), group: G.file, run: copyPositionLink },
  { id: "file.save-image", title: msg("판 그림 저장"), group: G.file, run: saveBoardImage },

  { id: "engine.start", title: msg("엔진 시작"), group: G.engine, run: () => engine().start() },
  { id: "engine.stop", title: msg("엔진 종료"), group: G.engine, run: () => engine().terminate() },
  {
    id: "engine.restart",
    title: msg("엔진 다시 띄우기"),
    group: G.engine,
    run: () => engine().restart(),
  },
  {
    id: "engine.hash-clear",
    title: msg("해시 비우기"),
    group: G.engine,
    run: () => engine().send({ kind: "raw", line: "YXHASHCLEAR" }),
  },

  {
    id: "db.save",
    title: msg("DB 저장"),
    group: G.db,
    run: async () => {
      const note = await useDbStore.getState().save();
      if (typeof note === "string") notice(note);
    },
  },
];

/** 레일의 화면들 — 보이는 레일과 같은 번호(Ctrl+1…). */
function navCommands(): AppCommand[] {
  const pro = useSettingsStore.getState().showAdvanced;
  return RAIL.filter((d) => pro || !d.pro).map((d, i) => ({
    id: `nav.${d.path.slice(1)}`,
    title: d.label,
    group: G.nav,
    ...(i < 9 ? { keys: `Ctrl+${i + 1}` } : {}),
    run: () => navigate(d.path),
  }));
}

/** 지금 부를 수 있는 앱 명령 전부. */
export function appCommands(): AppCommand[] {
  return [...BASE, ...navCommands()];
}

export function findCommand(id: string): AppCommand | undefined {
  return appCommands().find((c) => c.id === id);
}
