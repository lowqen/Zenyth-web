import { create } from "zustand";
import { t } from "../../i18n/i18n";
import { useEngineStore } from "../../engine/engine-state";
import { importYixinFunction, parseSteps } from "./commandText";
import { findCommand } from "./registry";

/**
 * 사용자 명령(데스크톱 Z4) — Yixin 의 사용자 툴바 · 단축키(`function/*.txt`)를 대신한다. 이름 · 단계(`commandText`)
 * · 단축키 하나. 명령 팔레트에 «사용자 명령»으로 나오고, 단축키를 묶으면 어느 화면에서나 부른다.
 * 이 브라우저(웹뷰)에 남는다 — Yixin 파일은 가져오기만 하고 다시 쓰지 않는다(Yixin 은 그대로 제 파일을 쓴다).
 */

export interface UserCommand {
  id: string;
  name: string;
  /** 단계 글 — 한 줄에 하나(`@앱명령` 또는 엔진 줄). */
  steps: string;
  /** `Ctrl+Alt+K` 꼴(`hotkeyName`). 없으면 null. */
  hotkey: string | null;
}

const KEY = "zenyth.userCommands";

function load(): UserCommand[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((c: Partial<UserCommand>) =>
      typeof c?.id === "string" && typeof c.name === "string" && typeof c.steps === "string"
        ? [
            {
              id: c.id,
              name: c.name,
              steps: c.steps,
              hotkey: typeof c.hotkey === "string" ? c.hotkey : null,
            },
          ]
        : [],
    );
  } catch {
    return [];
  }
}

function save(list: readonly UserCommand[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* 저장이 안 돼도 이번 세션은 그대로 돈다 */
  }
}

const newId = () => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

interface UserCommandsState {
  list: UserCommand[];
  add: (c: Omit<UserCommand, "id">) => string;
  update: (id: string, patch: Partial<Omit<UserCommand, "id">>) => void;
  remove: (id: string) => void;
  /** Yixin `function/*.txt` 들을 가져온다. 사람이 읽을 결과 줄들을 돌려준다. */
  importYixin: (files: readonly { name: string; text: string }[]) => string[];
}

export const useUserCommands = create<UserCommandsState>()((set, get) => {
  const commit = (list: UserCommand[]) => {
    save(list);
    set({ list });
  };
  return {
    list: load(),
    add: (c) => {
      const id = newId();
      commit([...get().list, { ...c, id }]);
      return id;
    },
    update: (id, patch) => commit(get().list.map((c) => (c.id === id ? { ...c, ...patch } : c))),
    remove: (id) => commit(get().list.filter((c) => c.id !== id)),
    importYixin: (files) => {
      const notes: string[] = [];
      const added: UserCommand[] = [];
      for (const f of [...files].sort((a, b) =>
        a.name.localeCompare(b.name, "en", { numeric: true }),
      )) {
        const base = f.name.replace(/\.txt$/i, "");
        const r = importYixinFunction(f.text);
        if (r.unsupported.length)
          notes.push(
            t("{file}: 옮기지 못한 Yixin 명령 {list}", {
              file: f.name,
              list: r.unsupported.join(", "),
            }),
          );
        if (!r.steps) continue;
        const name = r.icon ? `${base} (${r.icon})` : base;
        added.push({ id: newId(), name, steps: r.steps, hotkey: null });
      }
      if (added.length) commit([...get().list, ...added]);
      return [t("Yixin 명령 {n}개를 가져왔습니다", { n: added.length }), ...notes];
    },
  };
});

/**
 * 사용자 명령 하나를 돌린다 — 단계를 차례로. 앱 명령은 끝나기를 기다리고, 엔진 줄은 보낸다. 엔진이 꺼져 있으면
 * 엔진 줄 앞에서 멈춘다(앞 단계는 이미 했다). 사람이 읽을 결과를 돌려준다(성공이면 null).
 */
export async function runUserCommand(c: UserCommand): Promise<string | null> {
  for (const step of parseSteps(c.steps)) {
    if (step.kind === "app") {
      const cmd = findCommand(step.id);
      if (!cmd) return t("«{name}»: 모르는 앱 명령 @{id}", { name: c.name, id: step.id });
      await cmd.run();
    } else {
      const s = useEngineStore.getState();
      if (s.status === "idle" || s.status === "error")
        return t("«{name}»: 엔진이 꺼져 있어 «{line}»을 보내지 못했습니다", {
          name: c.name,
          line: step.line,
        });
      s.send({ kind: "raw", line: step.line });
    }
  }
  return null;
}
