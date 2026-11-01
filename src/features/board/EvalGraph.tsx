import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { moveKey, label, type Move } from "../../core/model/move";
import type { EvalView } from "../../engine/eval-view";
import { useBoardStore } from "./boardStore";
import { t } from "../../i18n/i18n";
import { useGameStore } from "./gameStore";
import { useEvalHistory } from "./currentAnalysis";
import {
  buildSeries,
  changeAt,
  evalAtOrBefore,
  monotonePath,
  splitRuns,
  swings,
  tickStep,
  type SeriesPoint,
} from "./evalSeries";

/**
 * 형세 그래프 — 기보의 수마다 흑의 승률(0~100%). 앱 R3(2026-10-31)의 다시 그린 모양:
 *
 * - **작은 나무 판** 위에 그린다(보드 스킨의 나무색). 50% 위는 흑돌 색, 아래는 백돌 색 면 — 누가 얼마나 유리했는지
 *   면적으로 읽힌다. 판 위라서 라이트 · 다크 모두에서 두 돌 색이 다 보인다(카드 면 위에서는 테마마다 한쪽이 묻혔다).
 * - 선은 단조 3차 곡선(값을 넘어 출렁이지 않음), 점 없음, 판 격자선 색. 읽지 않은 구간은 끊고 점선으로 잇는다
 *   (`splitRuns` — 대국의 한 수 걸러 선 점은 이어 긋는다).
 * - 50% 선은 진하게, 25 · 75% 는 옅게, 판 왼쪽 위 «흑» · 아래 «백», 판 아래 수 번호(30수까지 5, 90수까지 10,
 *   그 뒤 20 마다). 한 수에 15%p 넘게 움직인 곳에 금색 점(최선수 링 색), 지금 수에 세로선 + 원(마지막 수 색).
 * - 머리: «형세» · «N수» · 앞선 쪽과 비율을 크게(«흑 63%») · 직전 읽은 수 대비 변화 알약(이득 본 쪽 돌 + «+8%p»).
 * - 손으로: 누르면 그 수로, 가로로 끌면 따라가며 수를 넘긴다(세로 끌기는 시트 · 화면 스크롤로 남긴다).
 *   생각 중이거나 물음이 떠 있으면 옮기지 않는다 — 툴바와 같은 규칙. 키보드는 ← → 뒤 Enter.
 *
 * 크기는 `viewBox` 가 진다 — 컨테이너 폭을 재지 않으므로 탭을 오가며 다시 붙어도 0 폭으로 그려질 일이 없다.
 * 가로축은 지금 판 + 앞으로 갈 수(무른 수)까지, 곧 기보 한 줄이다.
 */

const W = 320;
/** 나무 판의 높이와 그 아래 수 번호 줄 — 앱 132 + 18. */
const PLOT_H = 132;
const H = PLOT_H + 18;
const PAD = { top: 10, right: 10, bottom: 10, left: 24 };
const PW = W - PAD.left - PAD.right;
const PH = PLOT_H - PAD.top - PAD.bottom;

export function EvalGraph() {
  const stones = useBoardStore((s) => s.render.stones);
  const future = useBoardStore((s) => s.future);
  const size = useBoardStore((s) => s.render.size);
  const version = useEvalHistory((s) => s.version);
  const gotoPly = useGameStore((s) => s.gotoPly);
  const locked = useGameStore((s) => s.thinking || s.prompt !== null);
  const [hover, setHover] = useState<number | null>(null);

  const line = useMemo(() => [...stones, ...future], [stones, future]);
  const current = stones.length;
  const n = line.length; // 국면은 0..n (n+1 개)

  // 국면 i(첫 i 수)의 평가. 키를 한 수씩 늘려 가며 맵에서 찾는다.
  const points = useMemo(() => {
    void version; // 기록이 늘면 다시 센다(맵은 제자리에서 바뀐다)
    const byKey = useEvalHistory.getState().byKey;
    const out: (EvalView | null)[] = [];
    let key = "";
    for (let i = 0; i <= n; i++) {
      if (i > 0)
        key = i === 1 ? String(moveKey(line[0]!, size)) : `${key},${moveKey(line[i - 1]!, size)}`;
      out.push(byKey.get(key) ?? null);
    }
    return out;
  }, [line, n, size, version]);

  const series = useMemo(() => buildSeries(points), [points]);
  const x = (i: number) => PAD.left + (n === 0 ? 0 : (i / n) * PW);
  const y = (pct: number) => PAD.top + (1 - pct / 100) * PH;

  const xy = (pts: readonly SeriesPoint[]) => pts.map((p) => ({ x: x(p.ply), y: y(p.pct) }));
  const { runs, gaps } = useMemo(() => splitRuns(series), [series]);
  // 면은 곡선 · 빈 구간을 한 줄로 이은 것과 50% 선 사이 — 위쪽 반은 흑, 아래쪽 반은 백으로 잘라 칠한다.
  const areaPath = useMemo(() => {
    if (series.length === 0) return "";
    let d = "";
    for (const run of runs) {
      const seg = monotonePath(xy(run));
      d += d ? seg.replace(/^M/, "L") : seg;
    }
    const f = (v: number) => v.toFixed(1);
    return `${d}L${f(x(series.at(-1)!.ply))},${f(y(50))}L${f(x(series[0]!.ply))},${f(y(50))}Z`;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- x · y 는 n 으로만 바뀐다
  }, [runs, series, n]);
  const big = useMemo(() => swings(series), [series]);
  const clip = useId();

  const plyAt = (e: { clientX: number; currentTarget: Element }) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    return n === 0 ? 0 : Math.min(n, Math.max(0, Math.round(((px - PAD.left) / PW) * n)));
  };

  // 가로로 끌면 따라가며 수를 넘긴다 — 누른 채 움직인 동안만.
  const dragging = useRef(false);
  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const ply = plyAt(e);
    setHover(ply);
    if (dragging.current && ply !== useBoardStore.getState().render.stones.length) go(ply);
  };
  const onUp = () => {
    dragging.current = false;
  };

  const shown = hover ?? current;
  // 읽지 않은 국면이면 그 앞의 가장 가까운 평가를 보여 준다(「몇 수째의 값」인지 함께).
  const shownEval = evalAtOrBefore(points, shown);
  const go = (ply: number) => {
    if (!locked) gotoPly(ply);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const at = hover ?? current;
    if (e.key === "ArrowLeft") setHover(Math.max(0, at - 1));
    else if (e.key === "ArrowRight") setHover(Math.min(n, at + 1));
    else if (e.key === "Enter" || e.key === " ") go(at);
    else return;
    // 이동 바의 ← → 단축키(창 전체)와 겹치지 않게 여기서 멈춘다.
    e.preventDefault();
    e.stopPropagation();
  };

  const readout = shownEval
    ? `${describe(shownEval.view)}${shownEval.ply === shown ? "" : ` (${t("{n}수째", { n: shownEval.ply })})`}`
    : t("평가 없음");
  const delta = changeAt(points, shown);

  // 읽은 국면이 하나도 없으면 빈 축 대신 한 줄 — 빈 그래프는 «고장»처럼 읽힌다.
  if (series.length === 0) {
    return (
      <section className="panel evalgraph evalgraph--empty" aria-labelledby="evalgraph-title">
        <h2 id="evalgraph-title" className="panel__title">
          {t("형세")}
        </h2>
        <p className="panel__hint">{t("분석하면 수마다 쌓입니다")}</p>
      </section>
    );
  }

  const step = tickStep(n);
  const ticks: number[] = [];
  for (let i = step; i < n; i += step) ticks.push(i);

  return (
    <section className="panel evalgraph" aria-labelledby="evalgraph-title">
      <div className="evalgraph__head">
        <h2 id="evalgraph-title" className="panel__title">
          {t("형세")}
          <span className="panel__status tnum">{t("{n}수", { n: shown })}</span>
        </h2>
        <p className="evalgraph__value tnum" aria-live="polite">
          <strong className="evalgraph__readout">{readout}</strong>
          {delta !== null && delta !== 0 && (
            <span className="evalgraph__delta" data-side={delta > 0 ? "black" : "white"}>
              <span className="evalgraph__stone" aria-hidden="true" />
              {`+${Math.abs(delta)}%p`}
            </span>
          )}
        </p>
      </div>
      <svg
        className="evalgraph__plot"
        viewBox={`0 0 ${W} ${H}`}
        role="slider"
        tabIndex={0}
        aria-label={t("형세 그래프. 수를 고르면 그 국면으로 갑니다")}
        aria-valuemin={0}
        aria-valuemax={n}
        aria-valuenow={shown}
        aria-valuetext={`${plyLabel(shown, line, size)} · ${readout}`}
        data-points={series.length}
        data-locked={locked || undefined}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => {
          if (!dragging.current) setHover(null);
        }}
        onBlur={() => setHover(null)}
        onClick={(e) => go(plyAt(e))}
        onKeyDown={onKey}
      >
        <defs>
          <clipPath id={`${clip}-top`}>
            <rect x={0} y={0} width={W} height={y(50)} />
          </clipPath>
          <clipPath id={`${clip}-bottom`}>
            <rect x={0} y={y(50)} width={W} height={PLOT_H - y(50)} />
          </clipPath>
        </defs>
        {/* 작은 나무 판 — 보드 스킨의 나무색. */}
        <rect className="evalgraph__wood" x={0} y={0} width={W} height={PLOT_H} rx={8} />
        {[25, 75].map((v) => (
          <line
            key={v}
            className="evalgraph__grid"
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(v)}
            y2={y(v)}
          />
        ))}
        <path
          className="evalgraph__area evalgraph__area--black"
          d={areaPath}
          clipPath={`url(#${clip}-top)`}
        />
        <path
          className="evalgraph__area evalgraph__area--white"
          d={areaPath}
          clipPath={`url(#${clip}-bottom)`}
        />
        <line className="evalgraph__mid" x1={PAD.left} x2={W - PAD.right} y1={y(50)} y2={y(50)} />
        <text className="evalgraph__side" x={6} y={PAD.top + 8}>
          {t("흑")}
        </text>
        <text className="evalgraph__side" x={6} y={PLOT_H - PAD.bottom}>
          {t("백")}
        </text>

        {runs.map((run) =>
          run.length > 1 ? (
            <path key={run[0]!.ply} className="evalgraph__line" d={monotonePath(xy(run))} />
          ) : null,
        )}
        {gaps.map(([a, b]) => (
          <line
            key={a.ply}
            className="evalgraph__line evalgraph__line--gap"
            x1={x(a.ply)}
            y1={y(a.pct)}
            x2={x(b.ply)}
            y2={y(b.pct)}
          />
        ))}
        {big.map((p) => (
          <circle key={p.ply} className="evalgraph__swing" cx={x(p.ply)} cy={y(p.pct)} r={3.5} />
        ))}

        {/* 지금 국면 — 판에 놓인 수까지. 세로선 + 원(판의 마지막 수 링과 같은 색). */}
        <line
          className="evalgraph__now"
          x1={x(current)}
          x2={x(current)}
          y1={PAD.top}
          y2={PAD.top + PH}
        />
        {points[current] && (
          <circle
            className="evalgraph__dot"
            cx={x(current)}
            cy={y(points[current]!.blackPct)}
            r={4.5}
          />
        )}
        {hover !== null && hover !== current && (
          <line
            className="evalgraph__cross"
            x1={x(hover)}
            x2={x(hover)}
            y1={PAD.top}
            y2={PAD.top + PH}
          />
        )}

        {/* 판 아래 수 번호. */}
        {ticks.map((i) => (
          <text key={i} className="evalgraph__tick" x={x(i)} y={H - 4} textAnchor="middle">
            {i}
          </text>
        ))}
      </svg>
    </section>
  );
}

/** 앞선 쪽과 그 비율(«흑 63%» / «백 58%») — 앱 R3 의 머리 값. */
function describe(v: EvalView): string {
  if (v.mate)
    return v.mate.winner === "black"
      ? t("흑 {n}수 외통", { n: v.mate.plies })
      : t("백 {n}수 외통", { n: v.mate.plies });
  const b = Math.round(v.blackPct);
  return b >= 50 ? t("흑 {b}%", { b }) : t("백 {w}%", { w: 100 - b });
}

function plyLabel(ply: number, line: readonly Move[], size: number): string {
  if (ply === 0) return t("빈 판");
  const m = line[ply - 1];
  return m ? `${t("{n}수째", { n: ply })} ${label(m, size)}` : t("{n}수째", { n: ply });
}
