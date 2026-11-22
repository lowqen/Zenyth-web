/**
 * 제목 → 폴더 소스의 파일 이름(라이브러리 계획 §6 «이름 바꾸기»). 제목은 무엇이든 되고, 파일 이름은 여기서 만든다.
 * 브라우저 소스는 파일 이름이 `lib/<id>` 로 고정이라 쓰지 않는다 — 폴더 소스(L4)와 시트의 미리 보기가 쓴다.
 *
 * - `< > : " / \ | ? *` · 제어 문자(0 ~ 31) → `_`
 * - 끝의 점 · 공백 제거(Windows 가 말없이 떼어 다른 파일이 된다)
 * - 예약 이름(`CON` `PRN` `AUX` `NUL` `COM1`~`COM9` `LPT1`~`LPT9`, 확장자가 붙어도)은 뒤에 `_`
 * - NFC 정규화, UTF-8 255바이트 안으로(글자 중간에서 자르지 않는다), `.db` 유지
 * - 겹치면 ` (2)`, ` (3)` … — 대소문자만 다른 이름도 겹친 것으로 본다(Windows · macOS 기본 파일 시스템)
 */

const EXT = ".db";
const MAX_BYTES = 255;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

const utf8Len = (s: string) => new TextEncoder().encode(s).length;

/** UTF-8 `max` 바이트 안으로 — 서로게이트 쌍을 가르지 않게 코드 포인트 단위로 자른다. */
function clipBytes(s: string, max: number): string {
  let out = "";
  let n = 0;
  for (const ch of s) {
    const len = utf8Len(ch);
    if (n + len > max) break;
    out += ch;
    n += len;
  }
  return out;
}

/** 제목에서 파일 이름 줄기(확장자 없이)를 만든다. 비면 `db`. */
function stemOf(title: string): string {
  let s = title.normalize("NFC");
  if (s.toLowerCase().endsWith(EXT)) s = s.slice(0, -EXT.length);
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  s = s.replace(/[. ]+$/g, "").trim();
  if (!s) s = "db";
  if (RESERVED.test(s)) s += "_";
  return s;
}

/**
 * 제목 → 파일 이름. `taken` 은 이미 있는 이름들(자기 자신의 지금 이름은 빼고 준다).
 */
export function fileNameFor(title: string, taken: Iterable<string> = []): string {
  const used = new Set([...taken].map((n) => n.normalize("NFC").toLowerCase()));
  const stem = stemOf(title);
  for (let i = 1; ; i++) {
    const suffix = i === 1 ? "" : ` (${i})`;
    const room = MAX_BYTES - utf8Len(suffix + EXT);
    // 자른 끝에 다시 점 · 공백이 올 수 있다.
    const base = clipBytes(stem, room).replace(/[. ]+$/g, "") || "db";
    const name = base + suffix + EXT;
    if (!used.has(name.toLowerCase())) return name;
  }
}
