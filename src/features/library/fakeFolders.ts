import type { FsaDir, FsaFile } from "./fsaSource";
import { companionSuffix, type LibraryFileInfo, withTail } from "./source";
import type { FolderBridge } from "./tauriSource";

/**
 * 시험 전용 — 메모리 위의 가짜 폴더 둘. 앱 코드는 부르지 않는다(번들에 들지 않는다).
 *
 * - `fakeFsaDir`: File System Access 핸들의 쓰는 만큼(`fsaSource.ts` 의 `FsaDir` · `FsaFile`). 이름 비교는 대소문자를
 *   가리지 않는다(Windows · macOS 기본 파일 시스템처럼).
 * - `fakeBridge`: 데스크톱 셸 명령(`library.rs`)의 짝. 휴지통은 따로 둔 지도.
 */

const notFound = () => Object.assign(new Error("not found"), { name: "NotFoundError" });

export interface FakeNode {
  files: Map<string, { data: Uint8Array; mtime: number }>;
  dirs: Map<string, FakeNode>;
}

let clock = 1_700_000_000_000;
const tick = () => (clock += 1000);

const findKey = <T>(m: Map<string, T>, name: string) =>
  [...m.keys()].find((k) => k.toLowerCase() === name.toLowerCase());

export function fakeFsaDir(name = "lib", node: FakeNode = { files: new Map(), dirs: new Map() }) {
  const dir: FsaDir & { node: FakeNode } = {
    kind: "directory",
    name,
    node,
    async getFileHandle(n, opts) {
      let k = findKey(node.files, n);
      if (!k) {
        if (!opts?.create) throw notFound();
        node.files.set(n, { data: new Uint8Array(0), mtime: tick() });
        k = n;
      }
      return fileHandle(k);
    },
    async getDirectoryHandle(n, opts) {
      let k = findKey(node.dirs, n);
      if (!k) {
        if (!opts?.create) throw notFound();
        node.dirs.set(n, { files: new Map(), dirs: new Map() });
        k = n;
      }
      return fakeFsaDir(k, node.dirs.get(k)!);
    },
    async removeEntry(n) {
      const k = findKey(node.files, n);
      if (!k) throw notFound();
      node.files.delete(k);
    },
    async *entries() {
      for (const k of [...node.files.keys()]) yield [k, fileHandle(k)] as [string, FsaFile];
      for (const k of [...node.dirs.keys()])
        yield [k, fakeFsaDir(k, node.dirs.get(k)!)] as [string, FsaDir];
    },
    async queryPermission() {
      return "granted";
    },
    async requestPermission() {
      return "granted";
    },
  };

  function fileHandle(fname: string): FsaFile {
    let cur = fname;
    return {
      kind: "file",
      get name() {
        return cur;
      },
      async getFile() {
        const f = node.files.get(cur);
        if (!f) throw notFound();
        return new File([f.data as BlobPart], cur, { lastModified: f.mtime });
      },
      async createWritable() {
        const parts: BlobPart[] = [];
        return {
          async write(d: Blob | BufferSource | string) {
            parts.push(d as BlobPart);
          },
          async close() {
            const data = new Uint8Array(await new Blob(parts).arrayBuffer());
            node.files.set(cur, { data, mtime: tick() });
          },
          async abort() {},
        };
      },
      async move(a: FsaDir | string, b?: string) {
        const f = node.files.get(cur);
        if (!f) throw notFound();
        const target = typeof a === "string" ? node : (a as FsaDir & { node: FakeNode }).node;
        const to = typeof a === "string" ? a : b!;
        node.files.delete(cur);
        target.files.set(to, f);
        cur = to;
      },
    };
  }
  return dir;
}

export const bytes = (s: string) => new TextEncoder().encode(s);
export const text = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : undefined);

/** 데스크톱 다리 — 폴더 경로마다 지도 하나, 휴지통은 `${dir}|${name}` 열쇠. */
export function fakeBridge(dirs: Record<string, Map<string, { data: Uint8Array; mtime: number }>>) {
  const bin = new Map<string, { data: Uint8Array; mtime: number }>();
  const writes = new Map<number, { dir: string; name: string; parts: Uint8Array[] }>();
  let token = 0;
  const calls: string[] = [];
  const of = (dir: string) => {
    const m = dirs[dir];
    if (!m) throw new Error(`폴더가 없습니다: ${dir}`);
    return m;
  };
  /** 셸 `companions` 와 같은 규칙(웹 `companionSuffix`) — 짝 꼬리 목록. */
  const tails = (m: Map<string, unknown>, base: string) =>
    [...m.keys()].map((k) => companionSuffix(base, k)).filter((t): t is string => t !== null);
  const bridge: FolderBridge = {
    pickFolder: async () => Object.keys(dirs)[0] ?? null,
    exists: async (dir) => dir in dirs,
    list: async (dir) =>
      [...of(dir)].map(([name, f]): LibraryFileInfo => ({
        name,
        size: f.data.byteLength,
        mtime: f.mtime,
      })),
    stat: async (dir, name) => {
      const f = of(dir).get(name);
      return f ? { name, size: f.data.byteLength, mtime: f.mtime } : null;
    },
    read: async (dir, name, offset, length) => {
      calls.push(`read ${name} ${offset} ${length}`);
      const f = of(dir).get(name);
      if (!f) throw new Error("missing");
      return f.data.slice(offset, offset + length);
    },
    writeBegin: async (dir, name) => {
      writes.set(++token, { dir, name, parts: [] });
      return token;
    },
    writeChunk: async (t, b) => void writes.get(t)!.parts.push(b.slice()),
    writeCommit: async (t) => {
      const w = writes.get(t)!;
      writes.delete(t);
      const data = new Uint8Array(await new Blob(w.parts as BlobPart[]).arrayBuffer());
      of(w.dir).set(w.name, { data, mtime: tick() });
    },
    writeAbort: async (t) => void writes.delete(t),
    remove: async (dir, name) => void of(dir).delete(name),
    rename: async (dir, from, to) => {
      const m = of(dir);
      if (!m.has(from)) throw new Error(`missing: ${from}`);
      if (m.has(to)) throw new Error(`exists: ${to}`);
      for (const t of ["", ...tails(m, from)]) {
        const k = withTail(from, t);
        m.set(withTail(to, t), m.get(k)!);
        m.delete(k);
      }
    },
    trash: async (dir, name) => {
      const m = of(dir);
      for (const k of [name, ...tails(m, name).map((t) => withTail(name, t))]) {
        bin.set(`${dir}|${k}`, m.get(k)!);
        m.delete(k);
      }
    },
    restore: async (dir, name) => {
      const m = of(dir);
      for (const k of [...bin.keys()]) {
        const [d, n] = k.split("|") as [string, string];
        if (d === dir && (n === name || companionSuffix(name, n) !== null)) {
          m.set(n, bin.get(k)!);
          bin.delete(k);
        }
      }
    },
    purge: async (dir, name) => {
      for (const k of [...bin.keys()])
        if (
          k === `${dir}|${name}` ||
          (k.startsWith(`${dir}|`) && companionSuffix(name, k.slice(dir.length + 1)) !== null)
        )
          bin.delete(k);
    },
  };
  return { bridge, bin, calls };
}
