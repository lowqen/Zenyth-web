import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useEngineStore } from "../../engine/engine-state";
import { downloadBlob } from "../../app/download";
import { Disclosure } from "../../components/Disclosure";
import { Segmented } from "../../components/controls";
import { useRememberedOpen } from "../../components/useRememberedOpen";
import { localized, msg, t } from "../../i18n/i18n";
import { consoleFileName, filterConsole, parseConsoleInput, pushHistory } from "./consoleInput";
import {
  isHumanMessage,
  parseMessage,
  type FieldRole,
  type MessageField,
  type ParsedMessage,
} from "./consoleMessages";

/**
 * 엔진 콘솔 — 로그 보기 + 거르기 + 저장 + **명령 입력줄**(데스크톱 Z4). 엔진 화면(전체)과 데스크톱 보드
 * 옆 «엔진 로그»(작게)가 함께 쓴다.
 *
 * 입력줄은 piskvork 줄을 그대로 보낸다(`raw`) — Rapfi 확장 명령(`YXHASHDUMP` · `YXDBTOTXTALL` …)을 손으로
 * 부를 자리다. 위 · 아래 화살표로 앞서 보낸 줄을 다시 부른다. 보낸 줄은 워커가 `> ` 머리로 콘솔에 남긴다.
 *
 * 보기는 둘이다(기억된다). **메시지**(기본): 엔진이 사람에게 한 `MESSAGE` 줄만, 깊이 · 평가값 · 수순을 칸으로
 * 나눠서(`consoleMessages.ts`). **전체**: 보낸 줄 · INFO 블록까지 원시 줄 그대로 — 프로토콜을 좇을 때.
 */
export function EngineConsole({ compact = false }: { compact?: boolean }) {
  const lines = useEngineStore((s) => s.console);
  const status = useEngineStore((s) => s.status);
  const send = useEngineStore((s) => s.send);
  const clearConsole = useEngineStore((s) => s.clearConsole);
  const [query, setQuery] = useState("");
  const [raw, setRaw] = useRememberedOpen("console-raw");
  const pool = useMemo(() => (raw ? lines : lines.filter(isHumanMessage)), [lines, raw]);
  const shown = useMemo(() => filterConsole(pool, query), [pool, query]);
  const running = status !== "idle" && status !== "error";

  return (
    <div className="engineconsole" data-compact={compact || undefined}>
      <div className="engineconsole__bar">
        <Segmented
          label={t("로그 보기")}
          value={raw ? "raw" : "messages"}
          options={[
            { value: "messages", label: t("메시지") },
            { value: "raw", label: t("전체") },
          ]}
          onChange={(v) => setRaw(v === "raw")}
        />
        <span className="engineconsole__count panel__status tnum">
          {query
            ? t("{n}/{all}줄", {
                n: shown.length.toLocaleString(),
                all: pool.length.toLocaleString(),
              })
            : t("{n}줄", { n: pool.length.toLocaleString() })}
        </span>
        <button
          type="button"
          className="panel__link"
          disabled={shown.length === 0}
          onClick={() =>
            downloadBlob(consoleFileName(), shown.join("\n") + "\n", "text/plain;charset=utf-8")
          }
        >
          {t("저장")}
        </button>
        <button
          type="button"
          className="panel__link"
          onClick={clearConsole}
          disabled={lines.length === 0}
        >
          {t("지우기")}
        </button>
      </div>
      <input
        type="search"
        className="engineconsole__filter"
        value={query}
        placeholder={raw ? t("거르기 (> 보낸 줄, < 받은 줄)") : t("거르기")}
        aria-label={t("콘솔 거르기")}
        onChange={(e) => setQuery(e.target.value)}
      />
      {raw ? (
        <ConsoleView lines={shown} visible={compact ? 120 : 400} full={!compact} />
      ) : (
        <MessageLog
          lines={shown}
          visible={compact ? 80 : 300}
          full={!compact}
          empty={lines.length > 0 && pool.length === 0}
        />
      )}
      <CommandLine
        disabled={!running}
        onSend={(cmds) => cmds.forEach((line) => send({ kind: "raw", line }))}
      />
    </div>
  );
}

function CommandLine({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (cmds: string[]) => void;
}) {
  const [text, setText] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  /** 기록을 거슬러 오르는 자리 — null 이면 새로 쓰는 중. */
  const [cursor, setCursor] = useState<number | null>(null);

  const submit = () => {
    const cmds = parseConsoleInput(text);
    if (cmds.length === 0) return;
    onSend(cmds);
    setHistory((h) => pushHistory(h, cmds.join("\n")));
    setText("");
    setCursor(null);
  };

  return (
    <form
      className="engineconsole__input"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <span className="engineconsole__prompt" aria-hidden="true">
        &gt;
      </span>
      <input
        type="text"
        value={text}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        placeholder={disabled ? t("엔진이 꺼져 있습니다") : t("엔진에 보낼 명령 (예: YXHASHCLEAR)")}
        aria-label={t("엔진 명령")}
        onChange={(e) => {
          setText(e.target.value);
          setCursor(null);
        }}
        onPaste={(e) => {
          // 여러 줄을 붙여 넣으면 곧바로 줄마다 보낸다 — 한 줄 입력칸은 줄바꿈을 지운다.
          const pasted = e.clipboardData.getData("text");
          if (!pasted.includes("\n")) return;
          e.preventDefault();
          const cmds = parseConsoleInput(pasted);
          if (cmds.length === 0) return;
          onSend(cmds);
          setHistory((h) => pushHistory(h, cmds.join("\n")));
        }}
        onKeyDown={(e) => {
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          if (history.length === 0) return;
          e.preventDefault();
          const at =
            e.key === "ArrowUp"
              ? Math.max(0, (cursor ?? history.length) - 1)
              : cursor === null
                ? null
                : cursor + 1 >= history.length
                  ? null
                  : cursor + 1;
          setCursor(at);
          // 여러 줄로 보낸 기록은 한 줄로 보여 준다 — 다시 보내면 원래대로 줄마다 나뉜다.
          setText(at === null ? "" : history[at]!.replace(/\n/g, " ; "));
        }}
      />
      <button type="submit" disabled={disabled || text.trim() === ""}>
        {t("보내기")}
      </button>
    </form>
  );
}

/** 맨 아래를 보고 있을 때만 새 줄을 따라 내려간다 — 위로 올려 읽는 중에 끌려 내려가면 읽을 수가 없다. */
function useFollowScroll(ref: RefObject<HTMLElement | null>, lines: readonly string[]) {
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [ref, lines, follow]);
  return (e: { currentTarget: HTMLElement }) => {
    const el = e.currentTarget;
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
  };
}

/**
 * «전체» 보기 — 원시 줄 그대로. 줄바꿈하지 않고 가로로 스크롤한다 — 접히면 프로토콜을 눈으로 좇을 수 없게 된다.
 */
function ConsoleView({
  lines,
  visible,
  full,
}: {
  lines: readonly string[];
  visible: number;
  full: boolean;
}) {
  const ref = useRef<HTMLPreElement>(null);
  const onScroll = useFollowScroll(ref, lines);

  if (lines.length === 0) {
    return <p className="panel__hint">{t("엔진이 아직 아무 말도 하지 않았습니다.")}</p>;
  }
  return (
    <pre ref={ref} className={full ? "console console--full" : "console"} onScroll={onScroll}>
      {lines.slice(-visible).join("\n")}
    </pre>
  );
}

const ROLE_LABEL: Readonly<Partial<Record<FieldRole, string>>> = localized({
  depth: msg("깊이"),
  eval: msg("평가값"),
  speed: msg("속도"),
  node: msg("노드"),
  time: msg("시간"),
});

/** 평가값은 부호를 붙인다 — 양수와 음수가 한눈에 갈린다. 메이트(`M5` 류)는 엔진 표기 그대로. */
const signed = (v: string) => (/^\d/.test(v) ? `+${v}` : v);

function Field({ f }: { f: MessageField }) {
  if (f.role === "pv") {
    return (
      <span className="msglog__pv" title={f.value}>
        {f.value}
      </span>
    );
  }
  if (f.role === "text") return <span className="msglog__text">{f.value}</span>;
  return (
    <span className="msglog__field" data-role={f.role}>
      <span className="msglog__key">{ROLE_LABEL[f.role]}</span>
      <span className="msglog__val tnum">{f.role === "eval" ? signed(f.value) : f.value}</span>
    </span>
  );
}

function MessageRow({ m }: { m: ParsedMessage }) {
  if (m.kind === "note" || m.kind === "time") {
    return (
      <li className="msglog__row" data-kind={m.kind} title={m.text}>
        <span className="msglog__text">{m.text}</span>
      </li>
    );
  }
  const badge = m.kind === "final" ? t("탐색 끝") : m.kind === "pv" ? `#${m.rank ?? ""}` : null;
  return (
    <li className="msglog__row" data-kind={m.kind} title={m.text}>
      {badge && <span className="msglog__badge tnum">{badge}</span>}
      {m.fields.map((f, i) => (
        <Field key={i} f={f} />
      ))}
    </li>
  );
}

/**
 * «메시지» 보기 — 줄마다 한 행. 깊이마다의 줄은 칸(깊이 · 평가값 · 시간)과 수순, 탐색 끝 요약은 강조 행, 다중
 * PV 는 순위 배지, 그 밖의 말은 글 그대로(흐리게). 수순은 한 줄로 자르고 전체는 툴팁으로.
 */
function MessageLog({
  lines,
  visible,
  full,
  empty,
}: {
  lines: readonly string[];
  visible: number;
  full: boolean;
  /** 원시 줄은 있는데 사람용 메시지가 하나도 없다. */
  empty: boolean;
}) {
  const ref = useRef<HTMLOListElement>(null);
  const onScroll = useFollowScroll(ref, lines);
  const rows = useMemo(() => lines.slice(-visible).map(parseMessage), [lines, visible]);

  if (lines.length === 0) {
    return (
      <p className="panel__hint">
        {empty
          ? t("아직 엔진 메시지가 없습니다. 원시 줄은 «전체»에서 봅니다.")
          : t("엔진이 아직 아무 말도 하지 않았습니다.")}
      </p>
    );
  }
  return (
    <ol
      ref={ref}
      className={full ? "msglog msglog--full" : "msglog"}
      aria-label={t("엔진 메시지")}
      onScroll={onScroll}
    >
      {rows.map((m, i) => (
        <MessageRow key={lines.length - rows.length + i} m={m} />
      ))}
    </ol>
  );
}

/**
 * 데스크톱 보드 옆 «엔진 로그»(인스펙터 로그 칸, 계획 §4) — 접혀 있다가 열면 작은 콘솔. 엔진 화면으로 가지 않고도
 * 분석하면서 엔진이 무엇을 받고 말했는지 보고, 명령을 보낸다. 웹 보드에는 없다(웹은 엔진 화면 고급 모드).
 */
export function EngineLogPanel() {
  const n = useEngineStore((s) => s.console.length);
  return (
    <section className="panel panel--disclosure">
      <Disclosure
        id="engine-log"
        title={t("엔진 로그")}
        summary={t("{n}줄", { n: n.toLocaleString() })}
      >
        <EngineConsole compact />
      </Disclosure>
    </section>
  );
}
