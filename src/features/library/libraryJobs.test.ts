import { describe, expect, it } from "vitest";
import { metaRecord, YxdbWriter } from "../../core/database/yxdbfile";
import { keyOfMoves } from "../../core/database/yxdbkey";
import { move } from "../../core/model/move";
import { createLibraryJobs } from "./libraryJobs";
import { BUSY, type FromLibraryWorker } from "./protocol";

function smallDb(): Blob {
  const recs = [metaRecord(), { key: keyOfMoves(2, 15, []), value: new Uint8Array(0) }];
  recs.push({ key: keyOfMoves(2, 15, [move(7, 7)]), value: new Uint8Array([0x77, 0, 0, 0, 0]) });
  const out: Uint8Array[] = [];
  const w = new YxdbWriter(recs.length, (c) => out.push(c));
  for (const r of recs) {
    const b = new Uint8Array(r.key.length + r.value.length);
    b.set(r.key);
    b.set(r.value, r.key.length);
    w.record(b, 0, r.key.length, r.key.length, r.value.length);
  }
  w.finish();
  return new Blob(out as BlobPart[]);
}

describe("libraryJobs", () => {
  it("scan → progress … done", async () => {
    const got: FromLibraryWorker[] = [];
    const jobs = createLibraryJobs((m) => got.push(m), { deviceMemory: 8 });
    await jobs.handle({ type: "scan", id: 1, file: smallDb(), options: {} });
    const done = got.find((m) => m.type === "done");
    expect(done?.type === "done" && done.result.stats.records).toBe(2);
    expect(done?.type === "done" && done.result.stats.roots?.[0]?.subtree).toBe(2);
    expect(got.every((m) => m.id === 1)).toBe(true);
  });

  it("작업 중 다른 작업은 BUSY, 취소 메시지는 cancelled", async () => {
    const got: FromLibraryWorker[] = [];
    const jobs = createLibraryJobs((m) => got.push(m));
    const first = jobs.handle({ type: "scan", id: 1, file: smallDb(), options: {} });
    await jobs.handle({ type: "scan", id: 2, file: smallDb(), options: {} });
    await jobs.handle({ type: "cancel", id: 1 });
    await first;
    expect(got).toContainEqual({ type: "error", id: 2, message: BUSY });
    expect(got).toContainEqual({ type: "cancelled", id: 1 });
    expect(jobs.busy()).toBe(false);
  });

  it("공유 플래그로도 취소된다", async () => {
    const got: FromLibraryWorker[] = [];
    const jobs = createLibraryJobs((m) => got.push(m));
    const flag = new Int32Array(new SharedArrayBuffer(4));
    Atomics.store(flag, 0, 1);
    await jobs.handle({ type: "scan", id: 3, file: smallDb(), options: {}, cancelFlag: flag });
    expect(got).toContainEqual({ type: "cancelled", id: 3 });
  });

  it("병합 · 분리 작업(L3) — jobProgress … result, 쓰기는 대조한 Blob", async () => {
    const got: FromLibraryWorker[] = [];
    const jobs = createLibraryJobs((m) => got.push(m), { deviceMemory: 8 });
    const opts = { policy: "deeper" as const, joinComments: true };
    await jobs.handle({
      type: "job",
      id: 4,
      job: { kind: "mergeCount", files: [smallDb(), smallDb()], options: opts },
    });
    const r = got.find((m) => m.type === "result");
    if (r?.type !== "result" || !("summary" in r.result)) throw new Error("결과 없음");
    expect(r.result.summary).toMatchObject({ records: 3, positions: 2, overlaps: 2, differing: 0 });
    got.length = 0;
    await jobs.handle({
      type: "job",
      id: 5,
      job: { kind: "mergeWrite", sources: r.result.sources, options: opts, count: 3 },
    });
    const w = got.find((m) => m.type === "result");
    expect(w?.type === "result" && "file" in w.result && w.result.records).toBe(3);
    expect(got.some((m) => m.type === "jobProgress")).toBe(true);
    got.length = 0;
    await jobs.handle({
      type: "job",
      id: 6,
      job: { kind: "splitCount", file: smallDb(), base: null, withOpenings: true },
    });
    const c = got.find((m) => m.type === "result");
    expect(c?.type === "result" && "total" in c.result && c.result.solved).toBe(1);
  });
});
