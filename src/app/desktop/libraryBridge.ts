import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { LibraryFileInfo } from "../../features/library/source";
import type { FolderBridge } from "../../features/library/tauriSource";

/**
 * 라이브러리 폴더 다리(L4) — `features/library/tauriSource.ts` 의 `FolderBridge` 를 셸 명령으로 잇는다. 셸 쪽 짝은
 * `Zenyth-desktop/src-tauri/src/library.rs`(`lib_*`).
 *
 * 큰 바이트는 JSON 이 아니라 날것으로 오간다 — 읽기는 `tauri::ipc::Response`(ArrayBuffer), 쓰기는 요청 몸통(Uint8Array)
 * 에 조각을 싣고 토큰은 머리글(`x-lib-token`)로.
 *
 * `features/library/sources.ts` 가 셸 안에서만 동적 import 로 부른다 — 웹 번들은 이 파일을 받지 않는다.
 */
export function createFolderBridge(): FolderBridge {
  return {
    async pickFolder() {
      const r = await open({ directory: true, multiple: false });
      return typeof r === "string" ? r : null;
    },
    exists: (dir) => invoke<boolean>("lib_exists", { dir }),
    list: (dir) => invoke<LibraryFileInfo[]>("lib_list", { dir }),
    stat: (dir, name) => invoke<LibraryFileInfo | null>("lib_stat", { dir, name }),
    async read(dir, name, offset, length) {
      const buf = await invoke<ArrayBuffer | number[]>("lib_read", { dir, name, offset, length });
      return buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf);
    },
    writeBegin: (dir, name) => invoke<number>("lib_write_begin", { dir, name }),
    writeChunk: (token, bytes) =>
      invoke<void>("lib_write_chunk", bytes, { headers: { "x-lib-token": String(token) } }),
    writeCommit: (token) => invoke<void>("lib_write_commit", { token }),
    writeAbort: (token) => invoke<void>("lib_write_abort", { token }),
    remove: (dir, name) => invoke<void>("lib_remove", { dir, name }),
    rename: (dir, from, to) => invoke<void>("lib_rename", { dir, from, to }),
    trash: (dir, name) => invoke<void>("lib_trash", { dir, name }),
    restore: (dir, name) => invoke<void>("lib_restore", { dir, name }),
    purge: (dir, name) => invoke<void>("lib_purge", { dir, name }),
  };
}
