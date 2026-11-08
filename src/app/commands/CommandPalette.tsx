import { useEffect, useMemo, useRef, useState } from "react";
import { msg, t } from "../../i18n/i18n";
import { useBoardNotice } from "../../features/board/boardNotice";
import { appCommands } from "./registry";
import { runUserCommand, useUserCommands } from "./userCommands";
import { rankEntries, usePalette } from "./palette";

/**
 * 명령 팔레트(Ctrl+K, 데스크톱 Z4) — Yixin 의 툴바 · 메뉴를 한 칸에. 글자를 치면 이름 · 묶음 · id 로 거르고,
 * 위 · 아래로 고르고 Enter 로 부른다. 사용자 명령도 같은 목록에 «사용자 명령» 묶음으로 나온다.
 */

interface Entry {
  key: string;
  title: string;
  group: string;
  keys?: string;
  run: () => void | Promise<void>;
}

const USER_GROUP = msg("사용자 명령");

export function CommandPalette() {
  const open = usePalette((s) => s.open);
  const setOpen = usePalette((s) => s.setOpen);
  if (!open) return null;
  return <PaletteDialog onClose={() => setOpen(false)} />;
}

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const users = useUserCommands((s) => s.list);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const entries = useMemo<Entry[]>(() => {
    const app = appCommands().map((c) => ({
      key: c.id,
      title: t(c.title),
      group: t(c.group),
      ...(c.keys ? { keys: c.keys } : {}),
      run: c.run,
    }));
    const mine = users.map((u) => ({
      key: `user.${u.id}`,
      title: u.name,
      group: t(USER_GROUP),
      ...(u.hotkey ? { keys: u.hotkey } : {}),
      run: async () => {
        const why = await runUserCommand(u);
        if (why) useBoardNotice.getState().show(why);
      },
    }));
    return [...mine, ...app];
  }, [users]);
  const shown = useMemo(() => rankEntries(entries, query), [entries, query]);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const run = (e: Entry | undefined) => {
    if (!e) return;
    onClose();
    void Promise.resolve(e.run()).catch((err: unknown) =>
      useBoardNotice.getState().show(
        t("명령을 하지 못했습니다: {why}", {
          why: err instanceof Error ? err.message : String(err),
        }),
      ),
    );
  };

  return (
    <div className="palette" role="presentation" onMouseDown={onClose}>
      <div
        className="palette__box"
        role="dialog"
        aria-modal="true"
        aria-label={t("명령 팔레트")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={input}
          className="palette__input"
          value={query}
          placeholder={t("명령 찾기")}
          aria-label={t("명령 찾기")}
          aria-controls="palette-list"
          aria-activedescendant={shown[at] ? `palette-${at}` : undefined}
          role="combobox"
          aria-expanded="true"
          onChange={(e) => {
            setQuery(e.target.value);
            setAt(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setAt((i) => Math.min(shown.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setAt((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(shown[at]);
            }
          }}
        />
        <ul ref={listRef} id="palette-list" className="palette__list" role="listbox">
          {shown.length === 0 && <li className="palette__empty">{t("맞는 명령이 없습니다")}</li>}
          {shown.map((e, i) => (
            <li
              key={e.key}
              id={`palette-${i}`}
              data-i={i}
              role="option"
              aria-selected={i === at}
              className="palette__item"
              onMouseMove={() => setAt(i)}
              onClick={() => run(e)}
            >
              <span className="palette__title">{e.title}</span>
              <span className="palette__group">{e.group}</span>
              {e.keys && <kbd className="palette__keys">{e.keys}</kbd>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
