import type { DbStats } from "./yxdbindex";

/**
 * 통계를 낸 색인의 판 — 화면(메인 번들)이 색인 코드를 끌고 오지 않고 볼 수 있게 따로 둔다.
 * 2 = 해시에 규칙 · 판 크기 소금(라이브러리 L5-0, 2026-11-24). 1(칸 없음)은 같은 돌의 다른 규칙 · 판 국면을 한 국면으로
 * 합쳐 셌다 — 규칙 · 판이 섞인 DB 의 옛 통계만 다시 센다. 한 규칙만 든 DB 는 두 판의 결과가 같다.
 */
export const INDEX_VERSION = 2;

/** 지금 색인 판으로 믿을 수 있는 통계인가 — 옛 판이라도 규칙 · 판이 하나뿐이면 그대로 쓴다. */
export const statsCurrent = (s: DbStats | undefined): s is DbStats =>
  !!s && (s.indexVersion === INDEX_VERSION || Object.keys(s.rules ?? {}).length <= 1);
