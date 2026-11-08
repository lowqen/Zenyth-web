import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { BoardCanvas } from "../../core/board/BoardCanvas";
import { useBoardStore } from "./boardStore";
import { useGameStore, type BoardMode } from "./gameStore";
import { AnalysisOptions, AnalysisPanel } from "./AnalysisPanel";
import { EngineLogPanel } from "../engine/EngineConsole";
import { DESKTOP_LAYOUT } from "../../app/desktop/platform";
import { EvalBar } from "./EvalBar";
import { EvalGraph } from "./EvalGraph";
import { GamePanel } from "./GamePanel";
import { MODE_PANEL_ID } from "./ModeTabs";
import { PositionCard, PositionStrip } from "./PositionCard";
import { useBoardDb, useBoardDbSync } from "./boardDb";
import { dbCellTag } from "../database/dbTags";
import { useDbStore } from "../database/dbStore";
import { PromptPanel } from "./OpeningPanel";
import { LinkBackupBanner } from "./LinkBackupBanner";
import { MoveToolbar } from "./MoveToolbar";
import { SummaryLine } from "./SummaryLine";
import { RunLine } from "./RunLine";
import { BoardSheet } from "./BoardSheet";
import { useDeskLayout, useSheetLayout } from "./useSheetLayout";
import { StatusCapsule } from "./StatusCapsule";
import { Inspector } from "./Inspector";
import { useBoardNotice } from "./boardNotice";
import { useCurrentAnalysis } from "./currentAnalysis";
import { openGameFile } from "./gameFileActions";
import { useEngineStore } from "../../engine/engine-state";
import { EMPTY_SNAPSHOT } from "../../engine/engine-types";
import { useSettingsStore } from "../settings/settingsStore";
import type { Move } from "../../core/model/move";
import { t } from "../../i18n/i18n";

/**
 * 보드 화면 — [대국] | [분석] 두 탭.
 *
 * 탭은 `boardStore.place` 가 아니라 **`gameStore.tap`** 으로 간다. 그래야
 * 금수·차례·협상 단계·탭(모드)이 한 곳에서 판단된다 — 보드는 여전히 규칙을 모른다.
 *
 * **배치.** 왼쪽 칸은 평가 바와 보드뿐이라 판이 화면 높이를 다 쓴다. 오른쪽 칸은 위에서부터
 * 탭 + 퀵 액션 바 · 카드 · 이동 바다(좁은 세로 화면에서는 판 밑으로 이동 바 · 탭 · 카드). 판과
 * 기보는 두 탭이 함께 쓰고, 카드만 탭마다 바뀐다:
 *
 *   - **대국**: 대국 카드(엔진 상태 · 「지금 두기」 · 흑/백 · 시간 · 레벨 · 스레드 · 개시)
 *     → 국면(기권 · 무승부). 판에 분석 오버레이(값 칩 · 최선수 링 · 고스트)를 얹지 않는다.
 *   - **분석**: 엔진 카드(DEPTH · NPS · PV · 분석/정지) → 형세 그래프 → 분석 설정 → 국면
 *
 * 국면 카드는 넓은 화면에서 옆 칸 **맨 위**에, 좁은 화면에서는 탭의 카드 뒤에 놓이고 대신
 * 국면 요약 한 줄이 옆 칸 맨 위에 붙는다(`PositionCard` 주석).
 *
 * 탭을 바꿀 때 엔진을 어떻게 넘기는지(생각하던 대국의 수는 버리고, 분석은 멈추기만)는
 * `gameStore.setMode` 가 정한다 — 화면은 그리기만 한다.
 *
 * **DB(W8).** 붙어 있으면 지금 국면의 기록을 묻고(`useBoardDbSync`), 분석 탭의 판에 DB 칩
 * (자식 값 · 칸 글자)을 엔진 칩 위에 얹는다 — 증명되거나 사람이 적은 기록이 실시간 추정보다
 * 앞선다. 대국 탭에는 얹지 않는다(엔진 분석과 같은 탭 격리).
 */
export function BoardScreen() {
  const showEvalBar = useSettingsStore((s) => s.showEvalBar);
  const markBlocked = useBoardStore((s) => s.markBlocked);
  const mode = useGameStore((s) => s.mode);

  const tap = useGameStore((s) => s.tap);
  const refreshForbidden = useGameStore((s) => s.refreshForbidden);
  const status = useEngineStore((s) => s.status);
  useBoardDbSync();

  // 엔진이 **놀게 되는 순간**마다 금수를 물어본다. 기동 직후와 탐색이 끝난
  // 직후가 여기다 — 엔진의 착수 응답은 상태가 아직 searching 일 때 도착하므로,
  // 그때의 조회는 대국 스토어 쪽에서 건너뛰고 이 효과가 뒤이어 받아 온다.
  // 대국 스토어가 엔진 상태를 스스로 구독하면 두 스토어가 서로를 보게 된다.
  useEffect(() => {
    if (status === "ready") refreshForbidden();
  }, [status, refreshForbidden]);

  /** 거절 사유를 잠깐 띄운다. 아무 반응이 없으면 「먹통」으로 읽힌다. */
  const notice = useBoardNotice((s) => s.text);
  const noticeSeq = useBoardNotice((s) => s.seq);
  const showNotice = useBoardNotice((s) => s.show);
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => showNotice(null), 2200);
    return () => window.clearTimeout(id);
  }, [notice, noticeSeq, showNotice]);

  const onTap = useCallback(
    (m: Move) => {
      const r = tap(m);
      showNotice(r.kind === "rejected" ? r.reason : null);
    },
    [tap, showNotice],
  );

  // 기보 파일을 판에 끌어다 놓으면 연다. 파일을 끄는 동안에만 테두리를 그린다.
  const [dropping, setDropping] = useState(false);
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");
  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropping(true);
  };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDropping(false);
    const file = e.dataTransfer.files[0];
    if (file) void openGameFile(file).then((r) => showNotice(r.text));
  };

  const sheet = useSheetLayout();
  const desk = useDeskLayout();
  const toolbarRef = useRef<HTMLElement>(null);
  const modeLabel = mode === "game" ? t("대국") : t("분석");
  // 옆 칸의 카드들 — 웹 옆 칸과 데스크톱 인스펙터 «개요»가 같은 것을 쓴다(화면을 두 벌로 만들지 않는다).
  const cards = (
    <>
      {/* 물음은 맨 위 — 답하기 전까지 판이 잠기므로 가장 먼저 보여야 한다. 두 탭 모두. */}
      <PromptPanel />
      <LinkBackupBanner />
      <PositionStrip game={mode === "game"} />
      <PositionCard game={mode === "game"} />
      {mode === "game" ? (
        <GamePanel />
      ) : (
        <>
          <AnalysisPanel />
          <EvalGraph />
          <AnalysisOptions />
          {/* 데스크톱 보드에서는 로그가 인스펙터의 제 칸이다(Inspector). 좁은 데스크톱 창은 접이식 그대로. */}
          {DESKTOP_LAYOUT && !desk && <EngineLogPanel />}
        </>
      )}
    </>
  );

  // 데스크톱 Z5: 넓은 데스크톱 창 — 판 밑에 상태 캡슐 · 이동 바(독), 오른쪽은 인스펙터. 요약 줄은 캡슐이 맡는다.
  if (desk) {
    return (
      <div
        className="boardscreen"
        data-evalbar={showEvalBar || undefined}
        data-mode={mode}
        data-desk
      >
        <div
          className="boardscreen__board"
          data-drop={dropping || undefined}
          onDragOver={onDragOver}
          onDragLeave={() => setDropping(false)}
          onDrop={onDrop}
        >
          <div className="boardrow">
            {showEvalBar && <BoardEvalBar />}
            <MainBoard mode={mode} onTap={onTap} onLongPress={markBlocked} />
          </div>
          <div className="boarddock">
            <StatusCapsule />
            <MoveToolbar navRef={toolbarRef} />
          </div>
          {notice && (
            <p className="board-notice" role="status">
              {notice}
            </p>
          )}
        </div>
        <Inspector id={MODE_PANEL_ID} label={modeLabel}>
          <RunLine />
          {cards}
        </Inspector>
      </div>
    );
  }

  const side = (
    <aside id={MODE_PANEL_ID} className="boardscreen__side" role="tabpanel" aria-label={modeLabel}>
      {cards}
    </aside>
  );

  return (
    <div
      className="boardscreen"
      data-evalbar={showEvalBar || undefined}
      data-mode={mode}
      data-sheet={sheet || undefined}
    >
      {/* 판은 왼쪽 칸의 높이를 다 쓴다 — 판 위아래에 조작 줄을 두지 않는다. 탭 · 새 판은 오른쪽
          칸 맨 위(`stagebar`), 기보 이동은 오른쪽 칸 맨 아래(`transport`)다. 휴대폰 세로에서는
          판 → 이동 바 → 탭 · 새 판 → 카드 순으로 쌓인다(base.css 의 grid-template-areas). */}
      <div
        className="boardscreen__board"
        data-drop={dropping || undefined}
        onDragOver={onDragOver}
        onDragLeave={() => setDropping(false)}
        onDrop={onDrop}
      >
        {/* 평가 바와 판을 한 줄로 — 판은 바 몫을 뺀 정사각형이고, 바는 판과 같은
            높이다(CSS 의 컨테이너 단위). 둘을 묶어 가운데 둔다. */}
        <div className="boardrow">
          {showEvalBar && <BoardEvalBar />}
          <MainBoard mode={mode} onTap={onTap} onLongPress={markBlocked} />
        </div>
        {notice && (
          <p className="board-notice" role="status">
            {notice}
          </p>
        )}
      </div>
      {/* 판 아래의 요약 줄(최선수 · 차례)과 카드. [분석] | [대국] 은 상단 바 왼쪽(TopBar), 새 판 · 진영 전환은
          툴바. 휴대폰 세로에서는 둘이 판 아래 시트에 얹힌다(`BoardSheet`, 결정 Q4) — 판과 툴바는 움직이지 않는다. */}
      {sheet ? (
        <BoardSheet
          anchorRef={toolbarRef}
          summary={
            <>
              <SummaryLine />
              <RunLine />
            </>
          }
        >
          {side}
        </BoardSheet>
      ) : (
        <>
          <div className="boardscreen__summary">
            <SummaryLine />
            <RunLine />
          </div>
          {side}
        </>
      )}
      <MoveToolbar navRef={toolbarRef} />
    </div>
  );
}

/**
 * 판 — 보드 스토어의 그림과 엔진 스냅샷을 구독하는 것은 **이 잎 하나**다(데스크톱 Z6). 화면 전체가 구독하면 분석 중
 * 스냅샷(~10Hz)마다 툴바 · 카드 · 설정 칸까지 함께 다시 그려진다(scripts/perf.ts «범위 밖 리렌더»).
 */
function MainBoard({
  mode,
  onTap,
  onLongPress,
}: {
  mode: BoardMode;
  onTap: (m: Move) => void;
  onLongPress: (m: Move) => void;
}) {
  const render = useBoardStore((s) => s.render);
  useAnalysisOverlay(mode);
  return <BoardCanvas render={render} onTap={onTap} onLongPress={onLongPress} keyboard />;
}

/** 평가 바 — 빈 판인지만 본다(돌 배열 자체를 구독하면 수마다 다시 그려진다). */
function BoardEvalBar() {
  const empty = useBoardStore((s) => s.render.stones.length === 0);
  return <EvalBar empty={empty} />;
}

/**
 * 엔진 스냅샷 → 보드. **지금 국면의 것만**(`useCurrentAnalysis`) — 무른 직후 옛 국면의 값 칩·최선수 링·고스트가 새 판에
 * 얹히지 않는다. 그리고 **분석 탭에서만** — 대국 탭의 판에 최선수 링과 수순 고스트가 남으면 그것은 대국 중의 훈수다(탭 격리).
 * 스토어를 둘로 나눠 두고 여기서 잇는 이유는, 보드가 엔진을 **모르는 채로** 그려질 수 있어야 하기 때문이다(내보내기·정석
 * 미리보기 등).
 *
 * 판 잎(`MainBoard`) 안에서만 부른다(데스크톱 Z6) — 스냅샷 구독이 보드 화면 전체를 다시 그리지 않게.
 */
function useAnalysisOverlay(mode: BoardMode): void {
  const applyAnalysis = useBoardStore((s) => s.applyAnalysis);
  const analysis = useCurrentAnalysis();
  const db = useBoardDb();
  const dbShowText = useDbStore((s) => s.settings.showBoardText);
  const overlay = useMemo(() => {
    if (mode !== "analysis") return EMPTY_SNAPSHOT;
    if (!db || db.snap.cells.size === 0) return analysis;
    const tags = new Map(analysis.tags);
    // round 는 엔진 태그를 낡은 순으로 지울 때만 쓴다 — DB 칩은 매번 새로 얹으므로 0.
    for (const [k, c] of db.snap.cells) tags.set(k, { ...dbCellTag(c, dbShowText), round: 0 });
    return { ...analysis, tags };
  }, [mode, analysis, db, dbShowText]);
  useEffect(() => {
    applyAnalysis(overlay);
  }, [overlay, applyAnalysis]);
}
