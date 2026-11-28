import type { DbStats } from "./yxdbindex";

/**
 * 통계를 낸 색인의 판 — 화면(메인 번들)이 색인 코드를 끌고 오지 않고 볼 수 있게 따로 둔다.
 * 2 = 해시에 규칙 · 판 크기 소금(라이브러리 L5-0, 2026-11-24). 1(칸 없음)은 같은 돌의 다른 규칙 · 판 국면을 한 국면으로
 * 합쳐 셌다.
 * 3 = 비표준 부모는 주형 표를 던지지 않고(엇갈림만 자손으로 번진다) 뿌리마다 시작점(`DbRoot.start`)(L5-6, 2026-11-28).
 * 2 이하는 한 규칙 DB 라도 주형 분포가 무너졌을 수 있어 모두 한 번 다시 센다.
 */
export const INDEX_VERSION = 3;

/** 지금 색인 판으로 믿을 수 있는 통계인가. */
export const statsCurrent = (s: DbStats | undefined): s is DbStats =>
  !!s && (s.indexVersion ?? 1) >= INDEX_VERSION;
