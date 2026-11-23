import { useState, type ReactNode } from "react";
import { Sheet } from "../../components/Sheet";
import { Switch } from "../../components/controls";
import { Icon } from "../../components/icons";
import { ICON } from "../../components/icon-paths";
import type { MergePolicy } from "../../core/database/yxdbmerge";
import type { LibraryMetaRow } from "../../data/library";
import { t } from "../../i18n/i18n";
import { useDbStore } from "../database/dbStore";
import { DbCover } from "./DbCover";
import { coverKeyOf } from "./cover";
import { defaultMergeTitle, fmtCount, positionsText, ruleLabel } from "./format";
import { JobProgress } from "./JobProgress";
import type { MergePrepared } from "./libraryOps";
import { useLibraryStore } from "./libraryStore";

/**
 * 합치기 시트(라이브러리 계획 §7 «병합») — 3단계.
 *
 * 1. 순서 — 맨 위가 기준. 규칙 · 판이 섞이면 경고(키에 규칙이 있어 합칠 수는 있다).
 * 2. 겹칠 때 — [더 깊은 기록(권장)] · [기준 우선], 주석 이어 붙이기.
 * 3. 미리 보기 — 실제로 쓰기 전에 센다(합계 · 겹침 · 값이 다른 것). 이름 · 커버(기준의 것) · «원본을 휴지통으로».
 *
 * 결과는 늘 새 항목이다. 작업 중에 시트를 닫으면 작업을 멈춘다.
 */

const mainKey = (e: LibraryMetaRow): string | null => {
  const rules = e.stats?.rules;
  if (!rules) return null;
  return Object.entries(rules).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

export function MergeSheet({
  ids,
  open,
  onClose,
  onDone,
}: {
  ids: readonly string[];
  open: boolean;
  onClose: () => void;
  onDone: (entry: LibraryMetaRow) => void;
}) {
  const entries = useLibraryStore((s) => s.entries);
  const job = useLibraryStore((s) => s.job);
  const active = useDbStore((s) => (s.status !== "off" ? s.active?.id : null));
  const [order, setOrder] = useState<string[]>([...ids]);
  const [step, setStep] = useState(1);
  const [policy, setPolicy] = useState<MergePolicy>("deeper");
  const [joinComments, setJoin] = useState(true);
  const [prep, setPrep] = useState<MergePrepared | null>(null);
  const [title, setTitle] = useState("");
  const [trashOriginals, setTrash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openedFor, setOpenedFor] = useState(false);
  // 열 때마다 처음부터(렌더 중 맞추기)
  if (open !== openedFor) {
    setOpenedFor(open);
    if (open) {
      setOrder([...ids]);
      setStep(1);
      setPrep(null);
      setError(null);
      setTrash(false);
    }
  }

  const rows = order
    .map((id) => entries.find((e) => e.id === id))
    .filter((e): e is LibraryMetaRow => !!e);
  const keys = new Set(rows.map(mainKey).filter(Boolean));
  const mixed = keys.size > 1;
  const hasActive = rows.some((e) => e.id === active);
  const running = job?.kind === "merge";

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setOrder(next);
    setPrep(null);
  };

  const preview = async () => {
    setStep(3);
    setError(null);
    setPrep(null);
    setTitle(defaultMergeTitle(rows.map((e) => e.title)));
    const r = await useLibraryStore.getState().mergePreview(order, { policy, joinComments });
    if (r.ok) setPrep(r.value);
    else if (r.error) setError(r.error);
    else setStep(2);
  };

  const commit = async () => {
    if (!prep) return;
    setError(null);
    const r = await useLibraryStore.getState().merge(prep, title, trashOriginals && !hasActive);
    if (r.ok) onDone(r.value);
    else if (r.error) setError(r.error);
  };

  const close = () => {
    if (running) useLibraryStore.getState().cancelJob();
    onClose();
  };

  const base = rows[0];
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
      {step === 1 && (
        <button type="button" className="cta" disabled={rows.length < 2} onClick={() => setStep(2)}>
          {t("다음")}
        </button>
      )}
      {step === 2 && (
        <button type="button" className="cta" data-k="merge-preview" onClick={() => void preview()}>
          {t("미리 보기")}
        </button>
      )}
      {step === 3 && (
        <button
          type="button"
          className="cta"
          data-k="merge-commit"
          disabled={!prep || running}
          onClick={() => void commit()}
        >
          {t("합치기")}
        </button>
      )}
    </>
  );

  return (
    <Sheet open={open} title={t("합치기")} onClose={close} k="merge-sheet" actions={actions}>
      <div className="libflow">
        <Steps step={step} labels={[t("순서"), t("겹칠 때"), t("미리 보기")]} />

        {step === 1 && (
          <>
            <p className="panel__hint">
              {t("맨 위가 기준입니다. 겹치는 국면을 정할 때 앞섭니다.")}
            </p>
            <ol className="libmerge">
              {rows.map((e, i) => (
                <li key={e.id} className="libmerge__row">
                  <DbCover k={coverKeyOf(e.cover, e.stats)} seed={e.cover.seed} />
                  <span className="libmerge__text">
                    <span className="libmerge__title">
                      {e.title}
                      {i === 0 && <span className="libchip libchip--on">{t("기준")}</span>}
                    </span>
                    <span className="libmerge__sub tnum">
                      {[
                        e.stats ? positionsText(e.stats.records) : null,
                        mainKey(e) ? ruleLabel(mainKey(e)!) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="libmerge__move">
                    <button
                      type="button"
                      className="iconbtn"
                      aria-label={t("{title} 위로", { title: e.title })}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <Icon d={ICON.arrowUp} />
                    </button>
                    <button
                      type="button"
                      className="iconbtn"
                      aria-label={t("{title} 아래로", { title: e.title })}
                      disabled={i === rows.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <Icon d={ICON.arrowDown} />
                    </button>
                  </span>
                </li>
              ))}
            </ol>
            {mixed && (
              <p className="libwarn" role="note">
                {t("규칙 · 판이 섞여 있습니다. 국면 키에 규칙이 있어 합칠 수는 있습니다.")}
              </p>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <div className="libcrit" role="radiogroup" aria-label={t("겹칠 때")}>
              <Choice
                on={policy === "deeper"}
                onPick={() => setPolicy("deeper")}
                title={t("더 깊은 기록(권장)")}
                text={t("깊이가 큰 쪽, 같으면 승패가 정해진 쪽, 그래도 같으면 기준.")}
              />
              <Choice
                on={policy === "base"}
                onPick={() => setPolicy("base")}
                title={t("기준 우선")}
                text={t("맨 위 DB 의 기록을 씁니다. 거기 없는 국면만 다른 DB 에서.")}
              />
            </div>
            <label className="libswitch">
              <span>
                {t("주석 이어 붙이기")}
                <span className="panel__hint">{t("같은 글은 하나로 둡니다.")}</span>
              </span>
              <Switch label={t("주석 이어 붙이기")} on={joinComments} onChange={setJoin} />
            </label>
          </>
        )}

        {step === 3 && (
          <>
            <JobProgress />
            {error && (
              <p className="libwarn" role="alert">
                {error}
              </p>
            )}
            {prep && (
              <>
                <dl className="libsum" data-k="merge-summary">
                  <div>
                    <dt>{t("합계")}</dt>
                    <dd className="tnum">{fmtCount(prep.summary.positions)}</dd>
                  </div>
                  <div>
                    <dt>{t("겹침")}</dt>
                    <dd className="tnum">{fmtCount(prep.summary.overlaps)}</dd>
                  </div>
                  <div>
                    <dt>{t("값이 다른 것")}</dt>
                    <dd className="tnum">{fmtCount(prep.summary.differing)}</dd>
                  </div>
                </dl>
                <div className="libresult">
                  {base && (
                    <DbCover k={coverKeyOf(base.cover, base.stats)} seed={base.cover.seed} />
                  )}
                  <label className="field field--wide libresult__name">
                    <span className="field__label">{t("이름")}</span>
                    <span className="field__box">
                      <input
                        className="field__input field__input--text"
                        type="text"
                        value={title}
                        maxLength={120}
                        onChange={(ev) => setTitle(ev.currentTarget.value)}
                      />
                    </span>
                  </label>
                </div>
                <label className="libswitch">
                  <span>
                    {t("원본을 휴지통으로")}
                    <span className="panel__hint">
                      {hasActive
                        ? t("붙어 있는 DB 는 남깁니다.")
                        : t("휴지통에서 30일 안에 되돌릴 수 있습니다.")}
                    </span>
                  </span>
                  <Switch label={t("원본을 휴지통으로")} on={trashOriginals} onChange={setTrash} />
                </label>
              </>
            )}
          </>
        )}
        {hasActive && step < 3 && (
          <p className="panel__hint">{t("붙어 있는 DB 는 먼저 저장하고 접은 뒤 합칩니다.")}</p>
        )}
      </div>
    </Sheet>
  );
}

/** 단계 표시 — «1 순서 · 2 겹칠 때 · 3 미리 보기». */
export function Steps({ step, labels }: { step: number; labels: readonly string[] }) {
  return (
    <ol className="libsteps" aria-label={t("단계")}>
      {labels.map((l, i) => (
        <li
          key={l}
          aria-current={step === i + 1 ? "step" : undefined}
          data-done={step > i + 1 || undefined}
        >
          <span className="libsteps__n tnum">{i + 1}</span>
          {l}
        </li>
      ))}
    </ol>
  );
}

/** 고르기 카드 하나(라디오). */
export function Choice({
  on,
  onPick,
  title,
  text,
  disabled,
  children,
}: {
  on: boolean;
  onPick: () => void;
  title: string;
  text: string;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="libchoice" data-on={on || undefined}>
      <button
        type="button"
        role="radio"
        aria-checked={on}
        disabled={disabled}
        className="libchoice__head"
        onClick={onPick}
      >
        <span className="libchoice__dot" aria-hidden="true" />
        <span className="libchoice__text">
          <span className="libchoice__title">{title}</span>
          <span className="libchoice__sub">{text}</span>
        </span>
      </button>
      {on && children && <div className="libchoice__body">{children}</div>}
    </div>
  );
}
