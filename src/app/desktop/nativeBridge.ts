import { Channel, invoke } from "@tauri-apps/api/core";
import type { NativeBridge, NativeEvent } from "../../engine/engine-transport";
import type { NativeBuilds } from "../../engine/engine-client";
import type { NativeEngineSpec } from "../../engine/engine-types";

/**
 * 네이티브 엔진 다리(데스크톱 Z3) — `engine-transport.ts` 의 `NativeBridge` 를 셸 명령으로 잇는다.
 * 셸 쪽 짝은 `desktop/src-tauri/src/engine.rs`(`engine_open` · `engine_write` · `engine_close` · `engine_builds`).
 *
 * 사건은 세션마다 Tauri `Channel` 로 받는다 — 전역 이벤트와 달리 순서가 지켜지고, `open` 이 돌아오기 전에
 * 엔진이 낸 줄도 놓치지 않는다(채널이 명령보다 먼저 생긴다).
 *
 * `main.tsx` 가 `IS_DESKTOP` 일 때만 동적 import 로 부른다 — 웹 번들은 이 파일을 받지 않는다.
 */
export function createNativeBridge(): NativeBridge {
  return {
    async open(spec: NativeEngineSpec, onEvent: (e: NativeEvent) => void): Promise<number> {
      const channel = new Channel<NativeEvent>();
      channel.onmessage = onEvent;
      return invoke<number>("engine_open", { spec, onEvent: channel });
    },
    write: (id, text) => invoke<void>("engine_write", { id, text }),
    close: (id) => invoke<void>("engine_close", { id }),
    builds: () => invoke<NativeBuilds>("engine_builds"),
  };
}
