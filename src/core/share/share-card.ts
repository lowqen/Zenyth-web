import { t } from "../../i18n/i18n";
import {
  QUALITY_INFO,
  qualityName,
  type MoveQuality,
  type ReviewTally,
} from "../review/move-quality";

/**
 * 공유 카드(데스크톱 Z4) — Yixin `share_card_pixbuf`(main.c:9448)의 웹판. 1200×675(16:9) 어두운 카드에 왼쪽 판,
 * 오른쪽 제목 · 규칙 · 수 · 날짜, 리뷰가 있으면 흑 · 백 정확도 · 승률 곡선 · 등급 집계, 남는 자리에 수순.
 *
 * 무엇을 쓸지(`shareCardModel`, 순수 · 시험)와 그리기(`drawShareCard`, 캔버스)를 나눈다. 판 그림은 화면과 같은
 * `drawBoard` 로 그린 캔버스를 받는다.
 */

export const SHARE_W = 1200;
export const SHARE_H = 675;

/** Yixin 카드의 등급 순서 — 강제 수는 빼고, 집계에 있는 등급만 그린다. */
const GRADE_ORDER: readonly MoveQuality[] = [
  "brilliant",
  "great",
  "best",
  "excellent",
  "good",
  "inaccuracy",
  "mistake",
  "blunder",
  "missedWin",
];

export interface ShareCardInput {
  title: string;
  ruleName: string;
  size: number;
  moveCount: number;
  /** `YYYY-MM-DD`. */
  date: string;
  /** 판이 따르는 리뷰(없으면 null) — 집계와 흑 관점 승률(0..1, 국면 0..n). */
  review: { tally: ReviewTally; winRates: readonly number[] } | null;
  /** `h8i9j10` 꼴 수순. */
  moves: string;
}

export interface ShareGradeRow {
  quality: MoveQuality;
  color: string;
  label: string;
}

export interface ShareCardModel {
  title: string;
  meta: string;
  /** [흑, 백] 정확도 글 — 리뷰가 없으면 null. */
  accuracy: readonly [string, string] | null;
  winRates: readonly number[] | null;
  grades: readonly ShareGradeRow[];
  /** 리뷰가 없을 때의 안내. */
  hint: string | null;
  moves: string;
  footer: string;
}

const pct = (v: number | null) => (v === null ? t("없음") : `${v.toFixed(1)}%`);

export function shareCardModel(input: ShareCardInput): ShareCardModel {
  const r = input.review;
  const grades: ShareGradeRow[] = [];
  if (r)
    for (const q of GRADE_ORDER) {
      const [b, w] = r.tally.counts.get(q) ?? [0, 0];
      if (b + w === 0) continue;
      grades.push({
        quality: q,
        color: QUALITY_INFO[q].color,
        label: `${qualityName(q)}  ${b} / ${w}`,
      });
    }
  return {
    title: input.title || t("Zenyth 대국"),
    meta: t("{rule} · {size}x{size} · {n}수 · {date}", {
      rule: input.ruleName,
      size: input.size,
      n: input.moveCount,
      date: input.date,
    }),
    accuracy: r ? [pct(r.tally.blackAccuracy), pct(r.tally.whiteAccuracy)] : null,
    winRates: r && r.winRates.length >= 2 ? r.winRates : null,
    grades,
    hint: r ? null : t("대국 리뷰를 하면 정확도와 등급이 나옵니다."),
    moves: input.moves,
    footer: "Zenyth",
  };
}

/** 글자 단위로 폭에 맞춰 줄을 나눈다(수순은 띄어쓰기가 없다). 넘치는 줄은 버린다. */
export function wrapChars(
  text: string,
  width: number,
  measure: (s: string) => number,
  maxLines: number,
): string[] {
  const out: string[] = [];
  let line = "";
  for (const ch of text) {
    if (line && measure(line + ch) > width) {
      out.push(line);
      if (out.length >= maxLines) return out;
      line = ch;
    } else line += ch;
  }
  if (line && out.length < maxLines) out.push(line);
  return out;
}

const SANS = '"Pretendard Variable", Pretendard, system-ui, "Segoe UI", sans-serif';
const MONO = '"Cascadia Mono", Consolas, ui-monospace, monospace';

function rrect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** 한 줄 글 — 폭을 넘으면 말줄임. 글 높이(줄 간격)를 돌려준다. */
function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  font: string,
  color: string,
  maxW = 0,
): number {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  let out = s;
  if (maxW > 0 && ctx.measureText(out).width > maxW) {
    while (out.length > 1 && ctx.measureText(out + "…").width > maxW) out = out.slice(0, -1);
    out += "…";
  }
  ctx.fillText(out, x, y);
  return parseInt(/(\d+)px/.exec(font)?.[1] ?? "14", 10) * 1.3;
}

export function drawShareCard(
  ctx: CanvasRenderingContext2D,
  m: ShareCardModel,
  board: CanvasImageSource & { width: number; height: number },
): void {
  const bx = 24;
  const by = 24;
  const bs = SHARE_H - 48;
  const px = bx + bs + 30;
  const pw = SHARE_W - px - 24;

  ctx.fillStyle = "#1e2125";
  ctx.fillRect(0, 0, SHARE_W, SHARE_H);

  // 판 — 부드러운 틀 위에.
  rrect(ctx, bx - 6, by - 6, bs + 12, bs + 12, 10);
  ctx.fillStyle = "#2a2e33";
  ctx.fill();
  const sc = bs / Math.max(board.width, board.height);
  ctx.drawImage(
    board,
    bx + (bs - board.width * sc) / 2,
    by + (bs - board.height * sc) / 2,
    board.width * sc,
    board.height * sc,
  );

  let y = by - 4;
  y += text(ctx, m.title, px, y, `700 30px ${SANS}`, "#e8eaed", pw) + 2;
  y += text(ctx, m.meta, px, y, `400 16px ${SANS}`, "#9aa0a6", pw) + 12;

  if (m.accuracy) {
    const cw = (pw - 12) / 2;
    const ch = 76;
    const names = [t("흑 정확도"), t("백 정확도")];
    for (let k = 0; k < 2; k++) {
      const cx = px + k * (cw + 12);
      rrect(ctx, cx, y, cw, ch, 8);
      ctx.fillStyle = k === 0 ? "#16181b" : "#e5e7ea";
      ctx.fill();
      text(
        ctx,
        m.accuracy[k]!,
        cx + 14,
        y + 8,
        `700 28px ${SANS}`,
        k === 0 ? "#e8eaed" : "#202124",
      );
      text(ctx, names[k]!, cx + 14, y + 50, `400 13px ${SANS}`, k === 0 ? "#9aa0a6" : "#5f6368");
    }
    y += ch + 14;
  }

  if (m.winRates) {
    // 흑 관점 승률 — 가운데 점선이 50%.
    const gh = 90;
    const n = m.winRates.length - 1;
    rrect(ctx, px, y, pw, gh, 8);
    ctx.fillStyle = "#25282c";
    ctx.fill();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgb(255 255 255 / 0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + 6, y + gh / 2);
    ctx.lineTo(px + pw - 6, y + gh / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#8cbff2";
    ctx.lineWidth = 2;
    ctx.beginPath();
    m.winRates.forEach((v, i) => {
      const vx = px + 8 + ((pw - 16) * i) / n;
      const vy = y + gh - 8 - (gh - 16) * v;
      if (i === 0) ctx.moveTo(vx, vy);
      else ctx.lineTo(vx, vy);
    });
    ctx.stroke();
    y += gh + 14;
  }

  if (m.grades.length) {
    const colw = (pw - 12) / 2;
    const y0 = y;
    m.grades.forEach((g, i) => {
      const rx = px + (i % 2) * (colw + 12);
      const ry = y0 + Math.floor(i / 2) * 28;
      ctx.fillStyle = g.color;
      ctx.beginPath();
      ctx.arc(rx + 8, ry + 10, 7, 0, 2 * Math.PI);
      ctx.fill();
      text(ctx, g.label, rx + 22, ry, `400 15px ${SANS}`, "#c8ccd2", colw - 22);
    });
    y = y0 + Math.ceil(m.grades.length / 2) * 28 + 10;
  } else if (m.hint) {
    y += text(ctx, m.hint, px, y, `italic 400 15px ${SANS}`, "#9aa0a6", pw) + 10;
  }

  // 수순 — 바닥글 위 남는 자리를 채운다.
  const lineH = 16;
  const room = Math.floor((SHARE_H - 46 - y) / lineH);
  if (m.moves && room > 0) {
    ctx.font = `400 12px ${MONO}`;
    const lines = wrapChars(m.moves, pw, (s) => ctx.measureText(s).width, room);
    lines.forEach((l, i) => text(ctx, l, px, y + i * lineH, `400 12px ${MONO}`, "#8f959c"));
  }
  text(ctx, m.footer, px, SHARE_H - 40, `400 13px ${SANS}`, "#7d838a", pw);
}
