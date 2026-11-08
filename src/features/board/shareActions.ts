import { useBoardStore } from "./boardStore";
import { useBoardNotice } from "./boardNotice";
import { useGameStore } from "./gameStore";
import { drawBoard } from "../../core/board/board-renderer";
import { readBoardSkin } from "../../core/board/board-skin";
import { encodePosition } from "../../core/model/position-link";
import { downloadBlob } from "../../app/download";
import { t } from "../../i18n/i18n";
import { copyOrShow } from "../../components/copySheetStore";
import { useCurrentReview } from "../../data/current-review";
import { grade, matchesPrefix, maxIndex, tally, winRateAt } from "../../core/review/move-quality";
import { RULE_LABEL } from "../../core/model/rules";
import {
  SHARE_H,
  SHARE_W,
  drawShareCard,
  shareCardModel,
  type ShareCardInput,
} from "../../core/share/share-card";
import { dateStamp } from "../../core/review/report";

/** 내보내는 그림의 한 변(px) — 메신저 미리보기에서도 좌표가 읽히는 크기. */
const IMAGE_SIDE = 1024;

/**
 * 지금 판을 PNG 로 — 앱 국면 카드의 «이미지»(R1). 화면의 판과 **같은 그리기 함수**(`drawBoard`)에 같은 스킨
 * (지금 테마의 CSS 변수)을 넣는다 — 앱도 화면과 PNG 내보내기가 같은 `drawBoard` 다. 판 위의 분석 값 · 표식도
 * 화면 그대로 담긴다.
 */
function boardCanvas(): HTMLCanvasElement | null {
  const { render } = useBoardStore.getState();
  const canvas = document.createElement("canvas");
  canvas.width = IMAGE_SIDE;
  canvas.height = IMAGE_SIDE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  drawBoard(
    ctx,
    render,
    IMAGE_SIDE,
    readBoardSkin(document.querySelector(".board") ?? document.documentElement),
  );
  return canvas;
}

export async function saveBoardImage(): Promise<void> {
  const notice = useBoardNotice.getState().show;
  const { render } = useBoardStore.getState();
  const canvas = boardCanvas();
  if (!canvas) return;
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) {
    notice(t("이미지를 만들지 못했습니다"));
    return;
  }
  const base = useGameStore.getState().gameName ?? "zenyth";
  downloadBlob(`${base}-${render.stones.length}.png`, blob, "image/png");
  notice(t("판 이미지를 저장했습니다"));
}

/**
 * 국면 문자열 — 수순을 좌표로 이은 한 줄(`h8i9j10`). 링크(`?p=`)가 싣는 것과 같은 글이라 그대로 붙여 넣어
 * 주고받을 수 있다(앱 «국면 문자열»). 클립보드를 쓸 수 없는 곳에서는 직접 복사하도록 보여 준다.
 */
export async function copyPositionString(): Promise<void> {
  const { stones, size } = useBoardStore.getState().render;
  const text = encodePosition(stones, size);
  const notice = useBoardNotice.getState().show;
  if (await copyOrShow(text, t("국면 문자열입니다. 복사해 쓰세요"))) {
    notice(t("국면 문자열을 복사했습니다"));
  }
}

/** 판이 따르는 리뷰의 집계 · 승률 곡선 — 판이 리뷰한 대국을 벗어났으면 null(그 리뷰는 이 판의 이야기가 아니다). */
function shareReview(): ShareCardInput["review"] {
  const { data, preset, skipOpening } = useCurrentReview.getState();
  if (!data || !matchesPrefix(data, useBoardStore.getState().render.stones)) return null;
  const n = maxIndex(data);
  return {
    tally: tally(grade(data, preset, skipOpening)),
    winRates: Array.from({ length: n + 1 }, (_, i) => winRateAt(data, i, n)),
  };
}

/**
 * 공유 카드(데스크톱 Z4, Yixin «Share Game») — 16:9 PNG 를 저장하고, 되면 클립보드에도 그림으로 올린다.
 */
export async function saveShareCard(): Promise<void> {
  const notice = useBoardNotice.getState().show;
  const { render } = useBoardStore.getState();
  const { gameName, rule } = useGameStore.getState();
  const board = boardCanvas();
  const canvas = document.createElement("canvas");
  canvas.width = SHARE_W;
  canvas.height = SHARE_H;
  const ctx = canvas.getContext("2d");
  if (!board || !ctx) return notice(t("이미지를 만들지 못했습니다"));
  const model = shareCardModel({
    title: gameName ?? "",
    ruleName: RULE_LABEL[rule],
    size: render.size,
    moveCount: render.stones.length,
    date: dateStamp(Date.now()).slice(0, 10),
    review: shareReview(),
    moves: encodePosition(render.stones, render.size),
  });
  drawShareCard(ctx, model, board);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) return notice(t("이미지를 만들지 못했습니다"));
  downloadBlob(`${gameName ?? "zenyth"}-share.png`, blob, "image/png");
  let copied = false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    copied = true;
  } catch {
    /* 클립보드에 그림을 못 올리는 곳 — 저장만 */
  }
  notice(copied ? t("공유 카드를 저장하고 복사했습니다") : t("공유 카드를 저장했습니다"));
}
