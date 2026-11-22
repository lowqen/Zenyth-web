import type { Move } from "../../core/model/move";

/**
 * 판 전체의 작은 그림 — 라이브러리 상세의 뿌리 국면 줄. 뿌리는 24 ~ 52돌 국면도 있어 천원 둘레만 그리는
 * `MiniBoard`(7×7)로는 잘린다. 격자는 흐리게, 돌만 읽히면 된다.
 */
export function PositionThumb({ moves, size }: { moves: readonly Move[]; size: number }) {
  const step = 6;
  const pad = 4;
  const side = pad * 2 + step * (size - 1);
  const lines = Array.from({ length: size }, (_, i) => pad + i * step);
  return (
    <svg className="posthumb" viewBox={`0 0 ${side} ${side}`} aria-hidden="true">
      <rect className="miniboard__wood" width={side} height={side} rx="4" />
      <g className="miniboard__grid">
        {lines.map((p) => (
          <g key={p}>
            <line x1={pad} y1={p} x2={side - pad} y2={p} />
            <line x1={p} y1={pad} x2={p} y2={side - pad} />
          </g>
        ))}
      </g>
      {moves.map((m, i) => (
        <circle
          key={i}
          cx={pad + m.x * step}
          cy={pad + m.y * step}
          r={step * 0.46}
          className={i % 2 === 0 ? "miniboard__black" : "miniboard__white"}
        />
      ))}
    </svg>
  );
}
