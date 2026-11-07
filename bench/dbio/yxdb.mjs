/**
 * yixindb 파일 검사기 — DB I/O 벤치(run.mjs)가 저장 결과와 「저장 도중 죽였을 때」 남은 파일을 판정한다.
 *
 * 포맷(Rapfi database/yxdbstorage.cpp, 3c94c2a9):
 *   [LZ4 프레임(선택)] u32 레코드 수 · (u16 키 길이 · 키 · u16 값 길이 · 값) × 레코드 수
 *   키 = rule(1) · 너비(1) · 높이(1) · (x,y)×돌, 값 = label(1) · value(i16) · depthbound(i16) · 글(UTF-8)
 *   첫 레코드는 너비 · 높이가 0 인 메타데이터(charset="UTF-8")다.
 *
 * 외부 의존 없음 — LZ4 프레임 해제를 여기서 직접 한다(블록 연결 · 체크섬 플래그 모두 처리, 체크섬 검증은 하지 않음).
 */
import { readFileSync } from "node:fs";

const LZ4_MAGIC = 0x184d2204;

/** LZ4 프레임(연속 프레임 포함)을 푼다. 잘린 파일이면 Error. */
export function lz4FrameDecode(b) {
  let out = Buffer.allocUnsafe(Math.max(1 << 20, b.length * 6));
  let op = 0;
  let p = 0;
  const ensure = (n) => {
    if (op + n <= out.length) return;
    const nb = Buffer.allocUnsafe(Math.max(out.length * 2, op + n));
    out.copy(nb, 0, 0, op);
    out = nb;
  };
  const need = (n) => {
    if (p + n > b.length) throw new Error(`LZ4: 파일이 잘림(@${p}, ${n}바이트 더 필요)`);
  };
  while (p < b.length) {
    need(7);
    if (b.readUInt32LE(p) !== LZ4_MAGIC) throw new Error(`LZ4: 프레임 매직이 아님(@${p})`);
    p += 4;
    const flg = b[p];
    p += 2;
    p += (flg & 8 ? 8 : 0) + (flg & 1 ? 4 : 0) + 1;
    for (;;) {
      need(4);
      const bs = b.readUInt32LE(p);
      p += 4;
      if (bs === 0) break;
      const size = bs & 0x7fffffff;
      need(size + (flg & 16 ? 4 : 0));
      const end = p + size;
      if (bs & 0x80000000) {
        ensure(size);
        b.copy(out, op, p, end);
        op += size;
        p = end;
      } else {
        ensure(4 * 1024 * 1024 + size * 255);
        while (p < end) {
          const tok = b[p++];
          let lit = tok >> 4;
          if (lit === 15) {
            let x;
            do lit += x = b[p++];
            while (x === 255);
          }
          b.copy(out, op, p, p + lit);
          op += lit;
          p += lit;
          if (p >= end) break;
          const off = b[p] | (b[p + 1] << 8);
          p += 2;
          let ml = tok & 15;
          if (ml === 15) {
            let x;
            do ml += x = b[p++];
            while (x === 255);
          }
          ml += 4;
          let s = op - off;
          if (s < 0) throw new Error("LZ4: 잘못된 오프셋");
          if (off >= ml) {
            out.copy(out, op, s, s + ml);
            op += ml;
          } else for (let i = 0; i < ml; i++) out[op++] = out[s++];
        }
      }
      if (flg & 16) p += 4;
    }
    if (flg & 4) {
      need(4);
      p += 4;
    }
  }
  return out.subarray(0, op);
}

/**
 * 파일 하나를 끝까지 읽어 판정한다.
 * @returns {{ ok: true, records: number, rawBytes: number } | { ok: false, error: string }}
 *   records 는 메타데이터 레코드를 뺀 국면 수.
 */
export function checkYxdb(path) {
  let buf;
  try {
    buf = readFileSync(path);
  } catch (e) {
    return { ok: false, error: `읽기 실패: ${e.code ?? e.message}` };
  }
  try {
    const raw = buf.length >= 4 && buf.readUInt32LE(0) === LZ4_MAGIC ? lz4FrameDecode(buf) : buf;
    if (raw.length < 4) return { ok: false, error: "레코드 수 머리가 없음" };
    const n = raw.readUInt32LE(0);
    let p = 4;
    let records = 0;
    for (let i = 0; i < n; i++) {
      if (p + 2 > raw.length) return { ok: false, error: `레코드 ${i}/${n}에서 잘림` };
      const kl = raw.readUInt16LE(p);
      p += 2;
      if (kl === 0) continue; // 로더도 건너뛴다
      if (p + kl + 2 > raw.length) return { ok: false, error: `레코드 ${i}/${n}에서 잘림` };
      const meta = kl >= 3 && raw[p + 1] === 0 && raw[p + 2] === 0;
      p += kl;
      const rl = raw.readUInt16LE(p);
      p += 2 + rl;
      if (p > raw.length) return { ok: false, error: `레코드 ${i}/${n}에서 잘림` };
      if (!meta) records++;
    }
    if (p !== raw.length) return { ok: false, error: `레코드 뒤에 ${raw.length - p}바이트가 남음` };
    return { ok: true, records, rawBytes: raw.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
