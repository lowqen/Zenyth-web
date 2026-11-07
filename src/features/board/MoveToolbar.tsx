import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useBoardStore } from "./boardStore";
import { useGameStore } from "./gameStore";
import { useEngineStore } from "../../engine/engine-state";
import { useStartAnalysis, useStopAnalysis } from "./analysisActions";
import { COMPUTER_SIDE_LABEL, swappedSide } from "../../core/model/game";
import { Icon } from "../../components/icons";
import { ICON } from "../../components/icon-paths";
import { t } from "../../i18n/i18n";

/** 툴바를 따라 손가락(또는 마우스)이 이만큼 가면 한 수 넘어간다 — 앱 `ScrubStep`. */
const SCRUB_STEP = 28;
/** 누름과 끌기를 가르는 문턱. 이보다 덜 움직이면 버튼을 누른 것이다. */
const SCRUB_SLOP = 8;

type Tone = "strong" | "accent" | "bare";

/**
 * 판 밑의 수 이동 툴바 — 앱 `MoveToolbar`(UI 개편 2차 M5 와 그 보정).
 *
 * Mornye 플레이어의 버튼 묶음처럼 알약 배경 없이 크기가 다른 키를 늘어놓는다: 가운데 단 하나의 주 행동
 * ▶(84 × 56, 강한 강조 — 보드 화면에서는 돌의 색), 양옆 ‹ ›(56 × 56, 연한 강조), 바깥쪽 끝에 면 없는
 * 아이콘(44) — 새 판 · `|<` · `>|` · 진영 전환(대국 탭). 중요도는 크기와 색이 말한다. 대국 탭에는 ▶ 가 없다
 * (엔진은 제 차례에만 둔다). 분석 탭에서는 진영 전환 자리를 비워 두어 ▶ 가 정확히 가운데에 온다.
 *
 * 키는 누르면 모서리가 조금 각지고 스프링처럼 돌아온다. ▶ 는 엔진이 읽는 동안 둥글다 — 상태가 아이콘과
 * 모양 둘로 말한다.
 *
 * **훑기(scrub).** 툴바를 따라 가로로 끌면 28px 마다 한 수씩 넘어간다 — 40수에서 12수로 빨리 가는 길.
 * 버튼과 같은 무르기 · 되돌리기를 타고, 같은 자리에서 멈춘다(처음 · 끝 · 엔진이 제 수를 생각하는 중).
 * 문턱(8px)을 넘기 전에는 누름이고, 끌기가 끝난 직후의 클릭은 버리지 않으면 손을 뗀 키가 눌린다.
 *
 * 이름(aria-label)은 예전 이동 바 · 퀵 바의 것 그대로 — 스모크가 이름으로 집는다.
 * 좁은 칸에서는 묶음 전체가 비율대로 줄어든다(base.css, 0.7 배까지).
 */
export function MoveToolbar({ navRef }: { navRef?: RefObject<HTMLElement | null> } = {}) {
  const stones = useBoardStore((s) => s.render.stones.length);
  const ahead = useBoardStore((s) => s.future.length);

  const thinking = useGameStore((s) => s.thinking);
  const blocked = useGameStore((s) => s.thinking || s.prompt !== null);
  const prompt = useGameStore((s) => s.prompt);
  const side = useGameStore((s) => s.computerSide);
  const analysisTab = useGameStore((s) => s.mode === "analysis");
  const undoMove = useGameStore((s) => s.undoMove);
  const undoAll = useGameStore((s) => s.undoAll);
  const redoMove = useGameStore((s) => s.redoMove);
  const redoAll = useGameStore((s) => s.redoAll);
  const newGame = useGameStore((s) => s.newGame);
  const swapSides = useGameStore((s) => s.swapSides);

  const status = useEngineStore((s) => s.status);
  const available = useEngineStore((s) => Boolean(s.capabilities.variant));
  const owner = useEngineStore((s) => s.owner);
  const startAnalysis = useStartAnalysis();
  const stopAnalysis = useStopAnalysis();

  // 리뷰의 탐색은 분석이 아니다 — ⏸ 로 보이면 누른 사람이 리뷰를 끊는다.
  const analyzing = status === "searching" && !thinking && !owner;
  const playDisabled = !available || thinking || status === "starting";
  const canBack = stones > 0;
  const canForward = ahead > 0 && !blocked;
  const canSwap = (side === "white" || side === "black") && !thinking && prompt === null;

  // 데스크톱에서는 화살표로도 기보를 넘긴다. 입력칸에 있을 때와 조합키가 눌렸을 때는 비켜선다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const run = { ArrowLeft: undoMove, ArrowRight: redoMove, Home: undoAll, End: redoAll }[e.key];
      if (!run) return;
      e.preventDefault();
      run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undoMove, redoMove, undoAll, redoAll]);

  // ── 훑기 ──
  const drag = useRef<{ id: number; x: number; travel: number; on: boolean } | null>(null);
  const swallowClick = useRef(false);
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, travel: 0, on: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    if (!d.on) {
      if (Math.abs(dx) < SCRUB_SLOP) return;
      d.on = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    d.x = e.clientX;
    d.travel += dx;
    // 지금 상태를 그때그때 읽는다 — 한 번 끌기 안에서 여러 수를 넘기므로 렌더 때의 값은 낡는다.
    while (d.travel >= SCRUB_STEP) {
      d.travel -= SCRUB_STEP;
      const g = useGameStore.getState();
      if (useBoardStore.getState().future.length > 0 && !g.thinking && g.prompt === null)
        redoMove();
    }
    while (d.travel <= -SCRUB_STEP) {
      d.travel += SCRUB_STEP;
      if (useBoardStore.getState().render.stones.length > 0) undoMove();
    }
  };
  const endDrag = () => {
    if (drag.current?.on) swallowClick.current = true;
    drag.current = null;
  };

  const swapTitle = canSwap
    ? t("진영 전환: {from} → {to}", {
        from: COMPUTER_SIDE_LABEL[side],
        to: COMPUTER_SIDE_LABEL[swappedSide(side)],
      })
    : t("진영 전환은 컴퓨터가 한쪽을 맡은 대국에서만 됩니다(대국 탭 ▸ 흑 / 백)");

  return (
    <nav
      ref={navRef}
      className="toolbar"
      aria-label={t("수 이동")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClickCapture={(e) => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <Key
        tone="bare"
        icon={ICON.restart}
        label={t("새 판")}
        title={t("새 판: 판과 물음을 비우고 새로 시작합니다(개시와 컴퓨터 색은 그대로)")}
        onClick={newGame}
      />
      <Key
        tone="bare"
        icon={ICON.first}
        label={t("처음으로")}
        title={`${t("처음으로")} (Home)`}
        onClick={undoAll}
        disabled={!canBack}
      />
      <Key
        tone="accent"
        icon={ICON.prev}
        label={t("한 수 뒤로")}
        title={`${t("한 수 뒤로")} (←)`}
        onClick={undoMove}
        disabled={!canBack}
      />
      {analysisTab && (
        <Key
          tone="strong"
          icon={analyzing ? ICON.pause : ICON.play}
          label={analyzing ? t("엔진 멈춤") : t("엔진 분석")}
          onClick={analyzing ? stopAnalysis : startAnalysis}
          disabled={!analyzing && playDisabled}
          pressed={analyzing}
          round={analyzing}
        />
      )}
      <Key
        tone="accent"
        icon={ICON.next}
        label={t("한 수 앞으로")}
        title={`${t("한 수 앞으로")} (→)`}
        onClick={redoMove}
        disabled={!canForward}
      />
      <Key
        tone="bare"
        icon={ICON.last}
        label={t("끝으로")}
        title={`${t("끝으로")} (End)`}
        onClick={redoAll}
        disabled={!canForward}
      />
      {analysisTab ? (
        // 진영 전환의 자리는 남긴다 — 탭을 바꿔도 묶음이 옆으로 밀리지 않고 ▶ 가 가운데다.
        <span className="toolbar__gap" aria-hidden="true" />
      ) : (
        <Key
          tone="bare"
          icon={ICON.swap}
          label={t("진영 전환")}
          title={swapTitle}
          onClick={swapSides}
          disabled={!canSwap}
        />
      )}
    </nav>
  );
}

function Key({
  tone,
  icon,
  label,
  title,
  onClick,
  disabled,
  pressed,
  round,
}: {
  tone: Tone;
  icon: string;
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  round?: boolean;
}) {
  return (
    <button
      type="button"
      className={`toolbar__key toolbar__key--${tone}`}
      aria-label={label}
      title={title ?? label}
      aria-pressed={pressed}
      data-round={round || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon d={icon} />
    </button>
  );
}
