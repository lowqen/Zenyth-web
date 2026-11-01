import { useState } from "react";

/**
 * 진행 막대의 채움 — 뛰지 않고 미끄러진다(Z9 — 앱 `SmoothProgressBar`, P5).
 *
 * 진행은 계단으로 온다(리뷰는 수마다, 팩 변환은 몇천 판마다). 그 사이를 순간이동하는 막대는 멈췄다가 고장 난
 * 것처럼 보인다. **앞으로** 가는 걸음만 `--motion-value`(200ms)에 걸쳐 미끄러지고, 뒤로(새 실행) · 처음 값 ·
 * 끝(100%)은 바로 그 자리 — 막대가 한 것보다 많이 보이거나, 다시 시작을 진행처럼 그리지 않는다. 옆에 쓰는
 * 퍼센트 글자는 보간하지 않는다(실시간 숫자 규칙).
 */
export function SmoothFill({ fraction, className }: { fraction: number; className?: string }) {
  const f = Math.max(0, Math.min(1, fraction));
  const [last, setLast] = useState(f);
  const [glide, setGlide] = useState(false);
  if (last !== f) {
    setLast(f);
    setGlide(f > last && f < 1);
  }
  return (
    <span
      className={"smoothfill" + (className ? ` ${className}` : "")}
      data-glide={glide || undefined}
      style={{ width: `${f * 100}%` }}
    />
  );
}
