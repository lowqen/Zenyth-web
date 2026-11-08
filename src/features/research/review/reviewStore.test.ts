import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reportOf, resetReviewStoreForTest, useReviewStore } from "./reviewStore";
import { RapfiDb } from "../../../data/db";
import { listJobs, listReviews } from "../../../data/reviews";
import { useCurrentReview } from "../../../data/current-review";
import { useEngineStore } from "../../../engine/engine-state";
import { EMPTY_SNAPSHOT, type AnalysisSnapshot } from "../../../engine/engine-types";
import { useBoardStore } from "../../board/boardStore";
import { useGameStore } from "../../board/gameStore";
import { move } from "../../../core/model/move";

/**
 * 리뷰 스토어 — 엔진의 독점 탐색만 가짜로 갈아 끼우고(자물쇠는 진짜), 저장소는
 * fake-indexeddb. 체크포인트 · 이어서 하기 · 리포트 저장 · 보드 배지 자료까지 한 바퀴.
 */

let d: RapfiDb;
const searched: number[] = [];
/** 이 국면 수에 이르면 「취소」를 누른다(`Infinity` 면 누르지 않는다). */
let cancelAtPly = Infinity;

const answer = (ply: number): AnalysisSnapshot => ({
  ...EMPTY_SNAPSHOT,
  pvs: [
    { index: 0, depth: 8, winRate: 0.5, mate: null, evalCp: null, line: [move(0, ply)], round: 1 },
  ],
  bestMove: move(0, ply),
});

const s = () => useReviewStore.getState();
const board = () => useBoardStore.getState();

/** 대각선으로 띄엄띄엄 — 오목이 되지 않는 수순. */
const line = (n: number) =>
  Array.from({ length: n }, (_, i) => move((i * 3) % 15, Math.floor(i / 2) * 2));

beforeEach(async () => {
  d = new RapfiDb(`review-${Math.random()}`);
  searched.length = 0;
  cancelAtPly = Infinity;
  useEngineStore.setState({
    owner: null,
    status: "idle",
    send: () => {},
    stop: () => {},
    exclusiveSearch: async (stones) => {
      searched.push(stones.length);
      if (stones.length >= cancelAtPly) s().cancel();
      return answer(stones.length);
    },
  });
  useGameStore.setState({ thinking: false, result: null, prompt: null, gameName: null });
  board().clear();
  resetReviewStoreForTest(d);
  await s().init(d);
  s().setBudget({ seconds: 1, byDepth: false });
  s().setSkipOpening(false);
});

afterEach(async () => {
  await d.delete();
});

describe("지금 판 리뷰", () => {
  it("돌리고, 리포트를 남기고 고른다", async () => {
    for (const m of line(4)) board().place(m);
    board().undo(); // 무른 수까지 리뷰한다
    expect(await s().reviewBoard()).toBeNull();
    expect(searched).toEqual([0, 1, 2, 3, 4]);
    const [job] = await listJobs(d);
    expect(job!.status).toBe("done");
    expect(job!.result).toMatch(/^완료: 정확도 흑 [\d.]+% \/ 백 [\d.]+%, 4수$/);
    const reviews = await listReviews(d);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.moves).toEqual(line(4));
    expect(reviews[0]!.records).toHaveLength(5);
    expect(s().selectedId).toBe(reviews[0]!.id);
    // 보드 배지가 읽을 자료가 나갔다
    expect(useCurrentReview.getState().data?.moves).toEqual(line(4));
    // 엔진 자물쇠는 풀렸다
    expect(useEngineStore.getState().owner).toBeNull();
    expect(s().running).toBe(false);
  });

  it("빈 판이나 대국 엔진이 생각 중이면 거절한다", async () => {
    expect(await s().reviewBoard()).toBe("리뷰할 수가 없습니다");
    board().place(move(7, 7));
    useGameStore.setState({ thinking: true });
    expect(await s().reviewBoard()).toMatch(/대국 수를 계산 중/);
  });

  it("다른 작업이 엔진을 쥐고 있으면 거절한다", async () => {
    board().place(move(7, 7));
    useEngineStore.setState({ owner: "review" });
    expect(await s().reviewBoard()).toBe("이미 진행 중입니다");
  });
});

describe("이어서 하기", () => {
  it("취소하면 중단 — 같은 판을 다시 리뷰하면 체크포인트에서 잇는다", async () => {
    for (const m of line(5)) board().place(m);
    cancelAtPly = 2;
    await s().reviewBoard();
    const [job] = await listJobs(d);
    expect(job!.status).toBe("paused");
    expect(job!.index).toBe(2);
    expect(job!.result).toMatch(/2\/6에서 이어서/);
    expect(job!.records[1]!.blackWinRate).not.toBeNull();

    searched.length = 0;
    cancelAtPly = Infinity;
    expect(await s().reviewBoard()).toBeNull();
    expect(searched).toEqual([2, 3, 4, 5]); // 앞의 둘은 다시 읽지 않는다
    const jobs = await listJobs(d);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.status).toBe("done");
  });

  it("다른 판을 리뷰하면 지난 체크포인트는 걷어내고 처음부터 — 리포트는 남는다", async () => {
    for (const m of line(3)) board().place(m);
    await s().reviewBoard();
    for (const m of line(5)) board().place(m);
    cancelAtPly = 2;
    await s().reviewBoard();
    board().clear();
    for (const m of line(2)) board().place(m);
    searched.length = 0;
    cancelAtPly = Infinity;
    await s().reviewBoard();
    expect(searched).toEqual([0, 1, 2]);
    const jobs = await listJobs(d);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.moves).toEqual(line(2));
    expect(await listReviews(d)).toHaveLength(2);
  });

  it("새로고침으로 끊긴 작업도 같은 판이면 잇는다", async () => {
    await d.queue.add({
      order: 0,
      name: "x",
      size: 15,
      moves: line(3),
      status: "running",
      records: [],
      index: 2,
      result: "",
      createdAt: 1,
    });
    resetReviewStoreForTest(d);
    await s().init(d);
    s().setSkipOpening(false);
    expect(s().jobs[0]!.status).toBe("paused");
    for (const m of line(3)) board().place(m);
    await s().reviewBoard();
    expect(searched).toEqual([2, 3]);
  });
});

describe("리포트", () => {
  it("기준을 바꾸면 엔진 없이 다시 매긴다", async () => {
    for (const m of line(2)) board().place(m);
    await s().reviewBoard();
    const row = s().reviews[0]!;
    expect(reportOf(row, "strict").preset).toBe("strict");
    s().setPreset("lenient");
    expect(useCurrentReview.getState().preset).toBe("lenient");
  });

  it("보드로 가져가면 그 수까지 두고 나머지는 무른 수로", async () => {
    for (const m of line(4)) board().place(m);
    await s().reviewBoard();
    board().clear();
    s().openOnBoard(2);
    expect(board().render.stones).toEqual(line(4).slice(0, 2));
    expect(board().future).toEqual(line(4).slice(2));
  });

  it("지우면 고른 것도 풀린다", async () => {
    board().place(move(7, 7));
    await s().reviewBoard();
    await s().removeReview(s().selectedId!);
    expect(s().selectedId).toBeNull();
    expect(useCurrentReview.getState().data).toBeNull();
    expect(await listReviews(d)).toHaveLength(0);
  });
});

describe("엔진 로그", () => {
  it("리포트에 국면마다 한 줄이 남고, 중단한 작업은 이어서 잇는다", async () => {
    for (const m of line(4)) board().place(m);
    cancelAtPly = 2;
    await s().reviewBoard();
    let [job] = await listJobs(d);
    expect(job!.log).toHaveLength(2); // 0 · 1 국면
    cancelAtPly = Infinity;
    await s().reviewBoard();
    [job] = await listJobs(d);
    const [row] = await listReviews(d);
    expect(row!.log).toHaveLength(5);
    expect(row!.log![0]).toMatch(/^#0 흑 차례 · 깊이 0 · 최선 a15/); // 가짜 엔진의 통계는 비어 있다
    expect(job!.log).toEqual(row!.log);
  });
});
