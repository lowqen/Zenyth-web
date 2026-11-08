/**
 * 사용자 명령의 글 — 단계 해석 · Yixin `function/*.txt` 가져오기 · 단축키 이름(데스크톱 Z4). DOM · 스토어를 모르는
 * 순수 함수다(시험: commandText.test.ts).
 *
 * **단계**는 한 줄에 하나다.
 *   - `@<명령 id>` — 앱 명령(명령 팔레트에 있는 것, `registry.ts`). 예: `@board.first`
 *   - 그 밖의 줄 — 엔진에 그대로 보내는 piskvork 줄. 예: `YXHASHCLEAR`, `INFO max_node 100000`
 *   - `#` 로 시작하는 줄은 주석, 빈 줄은 버린다.
 *
 * Yixin 의 사용자 툴바 · 단축키(`function/toolbarN.txt` · `hotkeyN.txt`)는 같은 뜻의 단계로 옮긴다. Yixin 명령 중
 * 앱에 같은 것이 있는 것만 `@id` 로, `command on` … `command off` 사이의 줄은 엔진 줄로 옮기고, 나머지는 «옮기지
 * 못함»으로 알려 준다(조용히 버리지 않는다).
 */

export type Step = { kind: "app"; id: string } | { kind: "engine"; line: string };

export function parseSteps(text: string): Step[] {
  const out: Step[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (l === "" || l.startsWith("#")) continue;
    if (l.startsWith("@")) {
      const id = l.slice(1).trim();
      if (id) out.push({ kind: "app", id });
    } else out.push({ kind: "engine", line: l });
  }
  return out;
}

/** Yixin `execute_command` 의 이름 → 앱 명령 id. 뜻이 같은 것만(대소문자 무시). */
export const YIXIN_COMMANDS: Readonly<Record<string, string>> = {
  "undo all": "board.first",
  "undo one": "board.undo",
  "redo one": "board.redo",
  "redo all": "board.last",
  clear: "board.new",
  "thinking start": "analysis.start",
  "thinking stop": "analysis.stop",
  "thinking toggle": "analysis.toggle",
  resign: "game.resign",
  draw: "game.draw",
  dbsave: "db.save",
  "hash clear": "engine.hash-clear",
  getposclipboard: "file.copy-position",
};

export interface YixinImport {
  /** 단계 글(`parseSteps` 가 읽는 꼴). 옮길 것이 하나도 없으면 빈 글. */
  steps: string;
  /** 앱에 같은 것이 없어 옮기지 못한 Yixin 명령. */
  unsupported: string[];
  /** 툴바면 Yixin 아이콘 이름(이름 짓기에 쓴다), 단축키면 null. */
  icon: string | null;
}

/**
 * `function/*.txt` 하나. 꼴: 첫 줄 번호(툴바는 아이콘 자리, 단축키는 키 번호), 둘째 줄 아이콘 이름(단축키는 빈 줄),
 * 그 뒤 빈 줄을 건너 명령이 한 줄에 하나.
 */
export function importYixinFunction(text: string): YixinImport {
  const lines = text.split(/\r?\n/);
  const icon = (lines[1] ?? "").trim() || null;
  const steps: string[] = [];
  const unsupported: string[] = [];
  let engineMode = false;
  for (const raw of lines.slice(2)) {
    const l = raw.trim();
    if (l === "") continue;
    const lower = l.toLowerCase();
    if (lower === "command on") {
      engineMode = true;
      continue;
    }
    if (lower === "command off") {
      engineMode = false;
      continue;
    }
    if (engineMode) {
      steps.push(l);
      continue;
    }
    const id = YIXIN_COMMANDS[lower];
    if (id) steps.push(`@${id}`);
    else unsupported.push(l);
  }
  return { steps: steps.join("\n"), unsupported, icon };
}

/** 단축키 판정에 쓰는 KeyboardEvent 의 부분. */
export interface HotkeyLike {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/**
 * 누른 키의 이름 — `Ctrl+Alt+K` · `Ctrl+Shift+F2` · `F2`. 사용자 명령에 묶을 수 없는 키면 null: 수식키만 누른 것,
 * Ctrl · Alt 없이 누른 글자 키(글을 쓰는 키다), Meta 가 섞인 것.
 */
export function hotkeyName(e: HotkeyLike): string | null {
  if (e.metaKey) return null;
  const k = e.key;
  if (k === "Control" || k === "Shift" || k === "Alt" || k === "Meta") return null;
  const fn = /^F([1-9]|1[0-2])$/.test(k);
  if (!fn && !e.ctrlKey && !e.altKey) return null;
  const base = k.length === 1 ? k.toUpperCase() : k;
  return [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", base]
    .filter(Boolean)
    .join("+");
}
