import { describe, expect, it } from "vitest";

/**
 * 데스크톱 셸의 엔진 스레드 — Tauri 웹뷰에서는 워커 안의 같은 출처 중첩 워커가 열리지
 * 않아, em-pthread 워커만 blob 부트스트랩으로 연다. 부트스트랩으로 열린 번들은
 * `self.location` 이 `blob:` 이므로 글루 주소를 심어 둔 원래 주소로 만들어야 한다.
 */
describe("데스크톱 blob 엔진 스레드", () => {
  it("blob 부트스트랩으로 열린 엔진 스레드도 글루를 원래 출처에서 읽는다", async () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const imported: string[] = [];
    const script = "https://tauri.localhost/assets/engine-worker-relaxed-abc.js";
    g.self = g;
    g.name = "em-pthread";
    g.location = { href: "blob:https://tauri.localhost/3f1c" };
    g.__RAPFI_PTHREAD_SCRIPT__ = script;
    g.importScripts = (url: string) => imported.push(url);

    const mod = await import("./engine-worker");

    expect(imported).toEqual(["https://tauri.localhost/engine/rapfi-multi-simd128.js"]);
    // 부트스트랩 소스는 원래 주소를 심고 그 번들을 읽는다.
    const src = mod.pthreadBootstrapSource(script);
    const seen: Record<string, unknown> = {};
    new Function("self", "importScripts", src)(seen, (u: string) => (seen.loaded = u));
    expect(seen).toEqual({ __RAPFI_PTHREAD_SCRIPT__: script, loaded: script });

    expect(mod.needsBlobPthreads("https://tauri.localhost/assets/x.js")).toBe(true);
    expect(mod.needsBlobPthreads("https://zenyth.example/assets/x.js")).toBe(false);
    expect(mod.needsBlobPthreads("blob:https://tauri.localhost/1")).toBe(false);

    // em-pthread 만 blob 으로 바꾸고, 같은 번들은 blob 하나를 다시 쓴다. 두 번 감싸지 않는다.
    const made: Array<[string, string | undefined]> = [];
    class FakeWorker {
      constructor(url: string | URL, opts?: WorkerOptions) {
        made.push([String(url), opts?.name]);
      }
    }
    const scope = {
      Worker: FakeWorker as unknown as typeof Worker,
      location: { href: script },
    };
    mod.installBlobPthreads(scope);
    const once = scope.Worker;
    mod.installBlobPthreads(scope);
    expect(scope.Worker).toBe(once);
    new scope.Worker(script, { name: "em-pthread" });
    new scope.Worker(script, { name: "em-pthread" });
    new scope.Worker("/other.js", { name: "x" });
    expect(made[0]![0]).toMatch(/^blob:/);
    expect(made[1]![0]).toBe(made[0]![0]);
    expect(made[2]).toEqual(["/other.js", "x"]);
    expect(made.map((m) => m[1])).toEqual(["em-pthread", "em-pthread", "x"]);
  });
});
