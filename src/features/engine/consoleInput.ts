/**
 * 엔진 콘솔의 입력줄 · 거르기 — 화면과 떨어진 순수 함수(데스크톱 Z4: Yixin 의 명령 창을 콘솔 입력줄로).
 *
 * 입력은 줄 단위다. 여러 줄을 붙여 넣거나 `;` 로 이으면 조각마다 한 명령이다 — `YXDBTOTXTALL` 처럼 다음 줄에
 * 파일 이름을 받는 명령을 한 번에 보낼 수 있다(piskvork 명령에는 `;` 가 없다). 앞뒤 공백은 떼고 빈 조각은 버린다.
 */

export function parseConsoleInput(text: string): string[] {
  return text
    .split(/\r?\n|;/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

/** 입력 기록 — 최신이 끝. 바로 앞과 같으면 다시 쌓지 않는다. */
export const HISTORY_MAX = 50;
export function pushHistory(list: readonly string[], entry: string): string[] {
  if (list.at(-1) === entry) return [...list];
  const next = [...list, entry];
  return next.length > HISTORY_MAX ? next.slice(-HISTORY_MAX) : next;
}

/**
 * 콘솔 줄 거르기. 빈 칸이면 전부. `>` 로 시작하면 보낸 줄만(그 뒤 글자로 다시 거른다), `<` 면 받은 줄만.
 * 대소문자는 가리지 않는다.
 */
export function filterConsole(lines: readonly string[], query: string): readonly string[] {
  const q = query.trim();
  if (q === "") return lines;
  let pool = lines;
  let rest = q;
  if (q.startsWith(">")) {
    pool = lines.filter((l) => l.startsWith("> "));
    rest = q.slice(1).trim();
  } else if (q.startsWith("<")) {
    pool = lines.filter((l) => !l.startsWith("> ") && !l.startsWith("! "));
    rest = q.slice(1).trim();
  }
  if (rest === "") return pool;
  const needle = rest.toLowerCase();
  return pool.filter((l) => l.toLowerCase().includes(needle));
}

/** 저장 파일 이름 — `rapfi-console-YYYYMMDD-hhmmss.log`. */
export function consoleFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `rapfi-console-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.log`;
}
