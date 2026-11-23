import { useState } from "react";
import { ConfirmBox } from "../../components/ConfirmBox";
import { Sheet } from "../../components/Sheet";
import { Segmented } from "../../components/controls";
import { parseRuleBoard } from "../../core/database/yxdbfile";
import type { SplitBase, SplitCounts, SplitCriterion } from "../../core/database/yxdbsplit";
import { ABBR, COUNT, NONSTD, nameOf } from "../../core/opening/opening26";
import type { Move } from "../../core/model/move";
import type { LibraryCover, LibraryMetaRow } from "../../data/library";
import { t } from "../../i18n/i18n";
import { useBoardStore } from "../board/boardStore";
import { useDbStore } from "../database/dbStore";
import { DbCover } from "./DbCover";
import { coverKeyOf } from "./cover";
import { fmtCount, ruleLabel } from "./format";
import { JobProgress } from "./JobProgress";
import { useLibraryStore } from "./libraryStore";
import { Choice, Steps } from "./MergeSheet";

/**
 * 나누기 시트(라이브러리 계획 §7 «분리») — 3단계.
 *
 * 1. 기준 — 카드마다 개수: 주형별(고른 주형마다 한 파일 또는 묶어 한 파일) · 이 국면 아래(지금 판 국면 포함, 대칭까지) ·
 *    풀린 국면만(W/L/D) · 규칙 · 판(섞였을 때만). 개수는 열 때 한 번 센다(주형은 색인이 있어야 한다).
 * 2. 나머지 — [원본 그대로(권장, 복사)] · [원본에서 빼기(옮기기)]. 옮기기는 원본 사본을 휴지통에 두고 확인 상자를 띄운다.
 * 3. 미리 보기 — 결과마다 커버 · 이름(고칠 수 있다) · 개수, 검산 «결과 + 남는 것 = 원본 ✓».
 */

interface Planned {
  buckets: (number | string)[];
  count: number;
  title: string;
  cover: LibraryCover;
}

/** 지금 판을 «이 국면 아래»의 기준으로 — DB 에 그 판 크기의 규칙이 있어야 한다(가장 많은 것). */
function boardBase(entry: LibraryMetaRow, stones: readonly Move[], size: number): SplitBase | null {
  if (stones.length === 0) return null;
  const rules = Object.entries(entry.stats?.rules ?? {})
    .map(([k, n]) => ({ rb: parseRuleBoard(k), n }))
    .filter((x) => x.rb && x.rb.w === size && x.rb.h === size)
    .sort((a, b) => b.n - a.n);
  const rule = rules[0]?.rb?.rule ?? 2;
  return {
    rule,
    size,
    black: stones.filter((_, i) => i % 2 === 0),
    white: stones.filter((_, i) => i % 2 === 1),
  };
}

const openingName = (i: number) => (i === NONSTD ? t("미분류") : `${ABBR[i]} ${nameOf(i)}`);

export function SplitSheet({
  entry,
  open,
  onClose,
  onDone,
}: {
  entry: LibraryMetaRow;
  open: boolean;
  onClose: () => void;
  onDone: (made: LibraryMetaRow[]) => void;
}) {
  const job = useLibraryStore((s) => s.job);
  const attached = useDbStore((s) => s.status !== "off" && s.active?.id === entry.id);
  const [step, setStep] = useState(1);
  const [counts, setCounts] = useState<SplitCounts | null>(null);
  const [size, setSize] = useState(0);
  const [base, setBase] = useState<SplitBase | null>(null);
  const [crit, setCrit] = useState<SplitCriterion>("solved");
  const [picked, setPicked] = useState<number[]>([]);
  const [grouped, setGrouped] = useState(false);
  const [rules, setRules] = useState<string[]>([]);
  const [move, setMove] = useState(false);
  const [names, setNames] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openedFor, setOpenedFor] = useState(false);
  const running = job?.kind === "split";

  const count = async () => {
    const render = useBoardStore.getState().render;
    const b = boardBase(entry, render.stones, render.size);
    const r = await useLibraryStore.getState().splitPreview(entry.id, b);
    setBase(b);
    if (!r.ok) {
      if (r.error) setError(r.error);
      else onClose();
      return;
    }
    const c = r.value.counts;
    setCounts(c);
    setSize(r.value.size);
    // 기본 — 주형을 셀 수 있으면 주형별(분류된 주형 모두), 아니면 풀린 국면
    if (c.openings) {
      setCrit("opening");
      setPicked(c.openings.map((n, i) => (n > 0 && i !== NONSTD ? i : -1)).filter((i) => i >= 0));
    } else setCrit("solved");
    setRules(Object.keys(c.rules));
  };

  // 열 때마다 처음부터 — 개수를 센다(렌더 중 맞추기 + 시작)
  if (open !== openedFor) {
    setOpenedFor(open);
    if (open) {
      setStep(1);
      setCounts(null);
      setError(null);
      setMove(false);
      setConfirm(false);
      setGrouped(false);
    }
  }

  const planned = (): Planned[] => {
    if (!counts) return [];
    const name = (s: string) => `${entry.title} · ${s}`;
    if (crit === "opening" && counts.openings) {
      const ids = [...picked].sort((a, b) => a - b).filter((i) => counts.openings![i]! > 0);
      if (grouped) {
        const n = ids.reduce((s, i) => s + counts.openings![i]!, 0);
        return n
          ? [
              {
                buckets: ids,
                count: n,
                title: name(t("주형 {n}개", { n: ids.length })),
                cover: { mode: "auto", seed: entry.cover.seed },
              },
            ]
          : [];
      }
      return ids.map((i) => ({
        buckets: [i],
        count: counts.openings![i]!,
        title: name(i === NONSTD ? t("미분류") : nameOf(i)),
        cover:
          i === NONSTD
            ? { mode: "eclipse", seed: entry.cover.seed }
            : { mode: "opening", opening: i, seed: entry.cover.seed },
      }));
    }
    if (crit === "under")
      return counts.under && base
        ? [
            {
              buckets: ["in"],
              count: counts.under,
              title: name(t("{n}수 국면 아래", { n: base.black.length + base.white.length })),
              cover: entry.cover,
            },
          ]
        : [];
    if (crit === "solved")
      return counts.solved
        ? [
            {
              buckets: ["solved"],
              count: counts.solved,
              title: name(t("풀린 국면")),
              cover: entry.cover,
            },
          ]
        : [];
    return rules
      .filter((k) => (counts.rules[k] ?? 0) > 0)
      .map((k) => ({
        buckets: [k],
        count: counts.rules[k]!,
        title: name(ruleLabel(k)),
        cover: entry.cover,
      }));
  };

  const outs = planned();
  const sum = outs.reduce((s, o) => s + o.count, 0);
  const rest = (counts?.total ?? 0) - sum;

  const commit = async () => {
    if (!counts) return;
    setConfirm(false);
    setError(null);
    const r = await useLibraryStore.getState().split(entry.id, {
      plan: {
        criterion: crit,
        outputs: outs.map((o) => ({ buckets: o.buckets, count: o.count })),
        ...(move ? { rest: { count: rest } } : {}),
        ...(crit === "under" && base ? { base } : {}),
      },
      outputs: outs.map((o, i) => ({ title: names[i]?.trim() || o.title, cover: o.cover })),
      move,
      meta: counts.meta,
      size,
    });
    if (r.ok) onDone(r.value);
    else if (r.error) setError(r.error);
  };

  const close = () => {
    if (running) useLibraryStore.getState().cancelJob();
    onClose();
  };

  const toggle = <T,>(list: T[], v: T): T[] =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  const ruleKeys = counts ? Object.keys(counts.rules) : [];

  const actions = (
    <>
      <button type="button" className="ghostbtn" onClick={close}>
        {running ? t("멈추고 닫기") : t("닫기")}
      </button>
      {step > 1 && (
        <button
          type="button"
          className="ghostbtn"
          disabled={running}
          onClick={() => setStep(step - 1)}
        >
          {t("이전")}
        </button>
      )}
      {step < 3 && (
        <button
          type="button"
          className="cta"
          data-k="split-next"
          disabled={!counts || outs.length === 0}
          onClick={() => {
            if (step === 2) setNames(outs.map((o) => o.title));
            setStep(step + 1);
          }}
        >
          {t("다음")}
        </button>
      )}
      {step === 3 && (
        <button
          type="button"
          className={move ? "btn--danger" : "cta"}
          data-k="split-commit"
          disabled={running || outs.length === 0}
          onClick={() => (move ? setConfirm(true) : void commit())}
        >
          {t("나누기")}
        </button>
      )}
    </>
  );

  const why =
    counts?.openingsSkipped === "unordered"
      ? t("돌 수 순서로 저장된 파일이 아니라 주형을 셀 수 없습니다.")
      : counts?.openingsSkipped
        ? t("이 기기의 메모리로는 주형을 셀 수 없습니다.")
        : null;

  return (
    <Sheet
      open={open}
      title={t("나누기")}
      onClose={close}
      k="split-sheet"
      actions={actions}
      // 열리면 개수를 센다(주형은 색인 — 큰 DB 는 몇십 초)
      onOpened={() => void count()}
    >
      <div className="libflow">
        <Steps step={step} labels={[t("기준"), t("나머지"), t("미리 보기")]} />
        {(step === 1 || step === 3) && <JobProgress />}
        {error && (
          <p className="libwarn" role="alert">
            {error}
          </p>
        )}

        {step === 1 && counts && (
          <div className="libcrit" role="radiogroup" aria-label={t("기준")}>
            <Choice
              on={crit === "opening"}
              onPick={() => setCrit("opening")}
              disabled={!counts.openings}
              title={t("주형별")}
              text={
                counts.openings
                  ? t("{k}개 주형 · 미분류 {u}", {
                      k: counts.openings.filter((n, i) => n > 0 && i !== NONSTD).length,
                      u: fmtCount(counts.openings[NONSTD]!),
                    })
                  : (why ?? "")
              }
            >
              <Segmented
                label={t("파일")}
                value={grouped ? "one" : "each"}
                options={[
                  { value: "each", label: t("주형마다 한 파일") },
                  { value: "one", label: t("묶어 한 파일") },
                ]}
                onChange={(v) => setGrouped(v === "one")}
              />
              <ul className="libpick">
                {Array.from({ length: COUNT + 1 }, (_, i) => i)
                  .filter((i) => (counts.openings?.[i] ?? 0) > 0)
                  .map((i) => (
                    <li key={i}>
                      <label className="libpick__row">
                        <input
                          type="checkbox"
                          checked={picked.includes(i)}
                          onChange={() => setPicked(toggle(picked, i))}
                        />
                        <DbCover k={i === NONSTD ? "e0" : i} seed={entry.cover.seed} />
                        <span className="libpick__name">{openingName(i)}</span>
                        <span className="libpick__n tnum">{fmtCount(counts.openings![i]!)}</span>
                      </label>
                    </li>
                  ))}
              </ul>
            </Choice>
            <Choice
              on={crit === "under"}
              onPick={() => setCrit("under")}
              disabled={!base || !counts.under}
              title={t("이 국면 아래")}
              text={
                base
                  ? t("지금 판 {m}수 국면과 그 아래 {n} (대칭 포함)", {
                      m: base.black.length + base.white.length,
                      n: fmtCount(counts.under ?? 0),
                    })
                  : t("판에 돌을 놓으면 그 국면 아래를 나눌 수 있습니다.")
              }
            />
            <Choice
              on={crit === "solved"}
              onPick={() => setCrit("solved")}
              disabled={!counts.solved}
              title={t("풀린 국면만")}
              text={t("승패가 정해진(W · L · D) 국면 {n}", { n: fmtCount(counts.solved) })}
            />
            {ruleKeys.length > 1 && (
              <Choice
                on={crit === "rule"}
                onPick={() => setCrit("rule")}
                title={t("규칙 · 판")}
                text={t("규칙 · 판 {n}가지가 섞여 있습니다", { n: ruleKeys.length })}
              >
                <ul className="libpick">
                  {ruleKeys.map((k) => (
                    <li key={k}>
                      <label className="libpick__row">
                        <input
                          type="checkbox"
                          checked={rules.includes(k)}
                          onChange={() => setRules(toggle(rules, k))}
                        />
                        <span className="libpick__name">{ruleLabel(k)}</span>
                        <span className="libpick__n tnum">{fmtCount(counts.rules[k]!)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </Choice>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="libcrit" role="radiogroup" aria-label={t("나머지")}>
            <Choice
              on={!move}
              onPick={() => setMove(false)}
              title={t("원본 그대로(권장, 복사)")}
              text={t("원본은 바꾸지 않고 고른 국면을 새 DB 로 복사합니다.")}
            />
            <Choice
              on={move}
              onPick={() => setMove(true)}
              disabled={attached}
              title={t("원본에서 빼기(옮기기)")}
              text={
                attached
                  ? t("붙어 있는 DB 에서는 옮길 수 없습니다. 복사로 나누세요")
                  : t("원본에는 남는 {n} 만 둡니다. 원본 사본은 휴지통에 백업됩니다.", {
                      n: fmtCount(rest),
                    })
              }
            />
          </div>
        )}

        {step === 3 && counts && (
          <>
            <ul className="libsplit" data-k="split-outputs">
              {outs.map((o, i) => (
                <li key={o.buckets.join(",")} className="libsplit__row">
                  <DbCover k={coverKeyOf(o.cover, undefined)} seed={o.cover.seed} />
                  <span className="field__box libsplit__field">
                    <input
                      className="field__input field__input--text"
                      type="text"
                      aria-label={t("이름")}
                      value={names[i] ?? o.title}
                      maxLength={120}
                      onChange={(ev) => {
                        const v = ev.currentTarget.value;
                        setNames((ns) => {
                          const next = [...ns];
                          next[i] = v;
                          return next;
                        });
                      }}
                    />
                  </span>
                  <span className="libsplit__n tnum">{fmtCount(o.count)}</span>
                </li>
              ))}
              {move && (
                <li className="libsplit__row libsplit__row--rest">
                  <DbCover k={coverKeyOf(entry.cover, entry.stats)} seed={entry.cover.seed} />
                  <span className="libsplit__rest">
                    {t("«{name}» 에 남는 것", { name: entry.title })}
                  </span>
                  <span className="libsplit__n tnum">{fmtCount(rest)}</span>
                </li>
              )}
            </ul>
            <p className="libcheck tnum" data-k="split-check">
              {move
                ? t("결과 {a} + 남는 것 {b} = 원본 {c} ✓", {
                    a: fmtCount(sum),
                    b: fmtCount(rest),
                    c: fmtCount(counts.total),
                  })
                : t("결과 {a} · 원본 {c} 은 그대로", {
                    a: fmtCount(sum),
                    c: fmtCount(counts.total),
                  })}
            </p>
            {confirm && (
              <ConfirmBox
                className="libconfirm"
                text={t("원본에서 빼서 옮길까요? 원본 사본은 휴지통에 백업됩니다.")}
                confirmLabel={t("옮기기")}
                cancelLabel={t("취소")}
                danger
                onConfirm={() => void commit()}
                onCancel={() => setConfirm(false)}
              />
            )}
          </>
        )}
        {attached && step === 1 && (
          <p className="panel__hint">{t("붙어 있는 DB 는 먼저 저장하고 접은 뒤 나눕니다.")}</p>
        )}
      </div>
    </Sheet>
  );
}
