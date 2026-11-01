import { useEffect, useRef } from "react";

/** 이 비율까지는 곧은 선, 넘으면 물결(앱 `WaveFrom = 0.10`). */
const WAVE_FROM = 0.1;
/** 물결이 차오르는 시간(ms) — 곧은 선에서 물결로 넘어갈 때 툭 튀지 않게. */
const WAVE_IN_MS = 300;
const WAVELENGTH = 20;
const AMPLITUDE = 2.2;
const HEIGHT = 10;

/**
 * 물결 진행선 — 앱 `WavyProgress`(UI 개편 2차 M5 · 보정): 시간이 정해진 실행이 얼마나 갔는지.
 *
 * 엔진의 보고(초당 두 번 남짓)를 기다리지 않고 **그 실행의 속도(1 / 제한 시간)로 스스로 나아간다** — 보고 때마다
 * 머리가 튀던 것. 처음 10% 는 곧은 선이고, 넘으면 물결이 0.3초에 걸쳐 차오르며 초당 한 파장씩 흐른다. 그리기는
 * rAF 에서 경로만 바꾼다(React 렌더 없음). 감속 모드(`prefers-reduced-motion`)면 물결은 멈춘 그림이다.
 * 실시간 **숫자**는 보간하지 않는다는 규칙과 어긋나지 않는다 — 이것은 수치가 아니라 시간이 흐르는 그림이다.
 */
export function WavyProgress({
  startedAt,
  durationMs,
  className,
}: {
  startedAt: number;
  durationMs: number;
  className?: string;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const head = useRef<SVGPathElement>(null);
  const rest = useRef<SVGLineElement>(null);

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let waveAt: number | null = null;
    const draw = (now: number) => {
      const w = el.clientWidth || 1;
      el.setAttribute("viewBox", `0 0 ${w} ${HEIGHT}`);
      const p = Math.min(1, Math.max(0, (now - startedAt) / durationMs));
      const end = p * w;
      const mid = HEIGHT / 2;
      if (p >= WAVE_FROM && waveAt === null) waveAt = now;
      const grow = waveAt === null ? 0 : Math.min(1, (now - waveAt) / WAVE_IN_MS);
      const phase = still ? 0 : ((now / 1000) * 2 * Math.PI) % (2 * Math.PI);
      let d = `M0,${mid}`;
      for (let x = 1; x <= end; x += 1) {
        // 시작점은 반 파장에 걸쳐 선에서 출발한다.
        const lead = Math.min(1, x / (WAVELENGTH / 2));
        const y = mid + Math.sin((x / WAVELENGTH) * 2 * Math.PI - phase) * AMPLITUDE * grow * lead;
        d += `L${x.toFixed(1)},${y.toFixed(2)}`;
      }
      head.current?.setAttribute("d", d);
      rest.current?.setAttribute("x1", String(Math.min(w, end + 4)));
      rest.current?.setAttribute("x2", String(w));
      if (p < 1 || !still) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [startedAt, durationMs]);

  return (
    <svg
      ref={svg}
      className={"wavy" + (className ? ` ${className}` : "")}
      height={HEIGHT}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <line ref={rest} className="wavy__rest" x1={0} x2={0} y1={HEIGHT / 2} y2={HEIGHT / 2} />
      <path ref={head} className="wavy__head" />
    </svg>
  );
}
