import { useId } from "react";
import { representative, isDirect } from "../../core/opening/opening26";
import type { CoverKey } from "../../core/design/covers";

/**
 * 라이브러리 커버(라이브러리 계획 §6 «커버») — 이미지를 저장하지 않는 SVG. 주형 번호 · 무늬(seed)만으로 그린다.
 * 색은 `[data-cov]` 토큰(`covers.ts` → `tokens.css`)이라 테마를 따른다.
 *
 * - 주형: 천원 ±2 의 5×5 를 크게 잘라 대표 세 수. **直 = 정방 격자, 間 = 45° 돌린 마름모 격자** — 간접의 둘째 수
 *   (I9, 천원의 오른쪽 위)가 세로로 선다. 흑 = 그 색 톤 10, 백 = 진주.
 * - «일식»: 앱 마크(`ZenythMark`)와 같은 기하 — 먹 돌이 진주 돌 앞을 지난다. 무늬가 지나는 방향과 무리를 바꾼다.
 */

const PEARL = "#F6F1E9";

export function DbCover({
  k,
  seed = 0,
  size,
  className,
  label,
}: {
  k: CoverKey;
  seed?: number;
  /** 픽셀 — 없으면 CSS 가 정한다(격자 칸에 맞춘다). */
  size?: number;
  className?: string;
  /** 있으면 그림으로 읽힌다(`role="img"`), 없으면 꾸밈. */
  label?: string;
}) {
  // 같은 주형 커버가 한 화면에 여럿이라 그라데이션 id 는 그림마다 따로(숨은 칸의 정의를 가리키지 않게).
  const gid = `covg${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      className={"dbcover" + (className ? ` ${className}` : "")}
      data-cov={String(k)}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--c-cov-a)" />
          <stop offset="1" stopColor="var(--c-cov-b)" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${gid})`} />
      {typeof k === "number" ? <OpeningArt index={k} /> : <EclipseArt seed={seed} />}
    </svg>
  );
}

function OpeningArt({ index }: { index: number }) {
  const direct = isDirect(index);
  // 直은 세로로 세 칸까지, 間은 돌리면 대각 4.2칸까지 벌어진다 — 그 폭이 그림 안에 들게.
  const step = direct ? 20 : 15;
  const lines = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
  const moves = representative(index);
  // 세 돌을 그림 가운데로 — 돌린 뒤 화면 좌표의 테두리 상자 가운데를 (50, 50) 에 둔다. 격자는 돌과 함께 움직인다.
  const c = Math.SQRT1_2;
  const screen = moves.map((m) => {
    const x = (m.x - 7) * step;
    const y = (m.y - 7) * step;
    return direct ? [x, y] : [c * x + c * y, -c * x + c * y];
  });
  const mid = (k: 0 | 1) =>
    (Math.min(...screen.map((p) => p[k]!)) + Math.max(...screen.map((p) => p[k]!))) / 2;
  const tx = (50 - mid(0)).toFixed(2);
  const ty = (50 - mid(1)).toFixed(2);
  return (
    <g transform={direct ? `translate(${tx} ${ty})` : `translate(${tx} ${ty}) rotate(-45)`}>
      {lines.map((i) => (
        <g key={i} stroke="var(--c-cov-line)" strokeWidth="1">
          <line x1={-120} y1={i * step} x2={120} y2={i * step} />
          <line x1={i * step} y1={-120} x2={i * step} y2={120} />
        </g>
      ))}
      {moves.map((m, i) => (
        <circle
          key={i}
          cx={(m.x - 7) * step}
          cy={(m.y - 7) * step}
          r={step * 0.44}
          fill={i % 2 === 0 ? "var(--c-cov-stone)" : PEARL}
          stroke="var(--c-cov-rim)"
          strokeWidth="1.2"
        />
      ))}
    </g>
  );
}

function EclipseArt({ seed }: { seed: number }) {
  // 지나는 방향 8가지 × 무리(거리) 3가지 — 같은 서재에서 «일식» 둘이 나란히 서도 구별된다.
  const angle = (seed % 8) * 45;
  const gap = [17, 19, 21][Math.floor(seed / 8) % 3]!;
  return (
    <g transform={`rotate(${angle} 50 50)`}>
      <circle cx={50 + gap / 2 + 1} cy="50" r="23" fill={PEARL} />
      <circle cx={50 - gap / 2} cy="50" r="25.25" fill="var(--c-cov-b)" />
      <circle cx={50 - gap / 2} cy="50" r="20.75" fill="var(--c-cov-stone)" />
    </g>
  );
}
