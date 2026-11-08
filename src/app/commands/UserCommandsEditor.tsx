import { useRef, useState } from "react";
import { t } from "../../i18n/i18n";
import { useBoardNotice } from "../../features/board/boardNotice";
import { desktopAction } from "../desktop/keys";
import { hotkeyName, parseSteps } from "./commandText";
import { findCommand } from "./registry";
import { runUserCommand, useUserCommands, type UserCommand } from "./userCommands";

/**
 * 설정 ▸ PC 설정 ▸ 사용자 명령(데스크톱 Z4) — Yixin 사용자 툴바 · 단축키 자리. 명령마다 이름 · 단계 · 단축키를
 * 고치고, Yixin `function/*.txt` 를 여러 개 한꺼번에 가져온다.
 */
export function UserCommandsEditor() {
  const list = useUserCommands((s) => s.list);
  const add = useUserCommands((s) => s.add);
  const importYixin = useUserCommands((s) => s.importYixin);
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="usercmds">
      {list.length === 0 && (
        <p className="panel__hint">
          {t("아직 없습니다. 명령 팔레트(Ctrl+K)에 «사용자 명령»으로 나옵니다.")}
        </p>
      )}
      {list.map((c) => (
        <UserCommandRow key={c.id} c={c} />
      ))}
      <div className="actions">
        <button
          type="button"
          className="btn"
          onClick={() => add({ name: t("새 명령"), steps: "", hotkey: null })}
        >
          {t("새 명령")}
        </button>
        <button type="button" className="btn" onClick={() => input.current?.click()}>
          {t("Yixin 명령 가져오기")}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept=".txt,text/plain"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = "";
          if (!files.length) return;
          void Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() }))).then(
            (read) => setResult(importYixin(read).join("\n")),
          );
        }}
      />
      {result && (
        <p className="desktopfile__result" role="status">
          {result}
        </p>
      )}
    </div>
  );
}

/** 단계 글에서 모르는 `@id` 를 찾는다 — 고치는 자리에서 바로 알려 준다. */
function unknownIds(steps: string): string[] {
  return parseSteps(steps).flatMap((s) => (s.kind === "app" && !findCommand(s.id) ? [s.id] : []));
}

function UserCommandRow({ c }: { c: UserCommand }) {
  const update = useUserCommands((s) => s.update);
  const remove = useUserCommands((s) => s.remove);
  const unknown = unknownIds(c.steps);
  return (
    <fieldset className="usercmd">
      <legend className="usercmd__legend">{c.name || t("이름 없음")}</legend>
      <label className="usercmd__field">
        <span>{t("이름")}</span>
        <input
          type="text"
          value={c.name}
          onChange={(e) => update(c.id, { name: e.target.value })}
        />
      </label>
      <label className="usercmd__field">
        <span>{t("단계")}</span>
        <textarea
          rows={Math.min(8, Math.max(2, c.steps.split("\n").length))}
          spellCheck={false}
          value={c.steps}
          placeholder={t("한 줄에 하나. @board.first 처럼 @로 앱 명령, 나머지는 엔진에 보낼 줄")}
          onChange={(e) => update(c.id, { steps: e.target.value })}
        />
      </label>
      {unknown.length > 0 && (
        <p className="usercmd__warn" role="status">
          {t("모르는 앱 명령: {list}", { list: unknown.map((id) => `@${id}`).join(", ") })}
        </p>
      )}
      <div className="usercmd__bar">
        <HotkeyField c={c} />
        <button
          type="button"
          className="panel__link"
          disabled={parseSteps(c.steps).length === 0}
          onClick={() =>
            void runUserCommand(c).then((why) =>
              useBoardNotice.getState().show(why ?? t("«{name}»을 실행했습니다", { name: c.name })),
            )
          }
        >
          {t("실행")}
        </button>
        <button type="button" className="panel__link" onClick={() => remove(c.id)}>
          {t("삭제")}
        </button>
      </div>
    </fieldset>
  );
}

/** 단축키 받아 적기 — 누르면 듣다가 다음 키 조합을 적는다. Esc 취소, Backspace · Delete 지우기. */
function HotkeyField({ c }: { c: UserCommand }) {
  const update = useUserCommands((s) => s.update);
  const [listening, setListening] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  return (
    <span className="usercmd__hotkey">
      <button
        type="button"
        className="btn"
        data-hotkey-capture=""
        aria-pressed={listening}
        onClick={() => {
          setListening(!listening);
          setWhy(null);
        }}
        onBlur={() => setListening(false)}
        onKeyDown={(e) => {
          if (!listening) return;
          if (e.key === "Escape") {
            e.preventDefault();
            setListening(false);
            return;
          }
          if (e.key === "Backspace" || e.key === "Delete") {
            e.preventDefault();
            update(c.id, { hotkey: null });
            setListening(false);
            return;
          }
          const name = hotkeyName(e);
          if (!name) return;
          e.preventDefault();
          if (desktopAction(e)) return setWhy(t("{key}는 앱 단축키입니다", { key: name }));
          const other = useUserCommands
            .getState()
            .list.find((o) => o.id !== c.id && o.hotkey === name);
          if (other)
            return setWhy(t("{key}는 «{name}»이 이미 씁니다", { key: name, name: other.name }));
          update(c.id, { hotkey: name });
          setWhy(null);
          setListening(false);
        }}
      >
        {listening ? t("키를 누르세요") : (c.hotkey ?? t("단축키 없음"))}
      </button>
      {why && <span className="usercmd__warn">{why}</span>}
    </span>
  );
}
