import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sheet } from "../../components/Sheet";
import { Disclosure } from "../../components/Disclosure";
import { Icon } from "../../components/icons";
import { ICON } from "../../components/icon-paths";
import { downloadBlob } from "../../app/download";
import { ABBR, COUNT, nameOf, labelOf } from "../../core/opening/opening26";
import { DEFAULT_SIZE } from "../../core/model/move";
import type { LibraryMetaRow } from "../../data/library";
import { t } from "../../i18n/i18n";
import { useDbStore } from "../database/dbStore";
import { CoverSheet } from "./CoverSheet";
import { SplitSheet } from "./SplitSheet";
import { DbCover } from "./DbCover";
import { coverKeyOf } from "./cover";
import { fmtBytes, fmtCount, fmtDate, mainRule, positionsText, ruleLabel } from "./format";
import { movesOfKey, openingMoves, useLibraryStore } from "./libraryStore";
import { PositionThumb } from "./PositionThumb";

/**
 * 라이브러리 상세(라이브러리 계획 §6 «상세 · 열람 동선», 조건 ③) — 물든 머리(큰 커버 · 이름 눌러 바꾸기) · 칩 ·
 * 채운 단추 [이 DB 열기], 그 아래 주형 분포 · 뿌리 국면 · [빈 판에서 열기] [편집기로] · 기록. 어떤 DB 든 여기서 판까지
 * 한 번에 간다 — 색인이 없어도(메모리 관문) 빈 판 · 편집기 줄은 늘 있다.
 *
 * 칸 전체가 커버 색으로 물든다(`[data-cov]` — 그 칸 안에서만, `[data-wood]` 선례).
 */

const ROOTS_SHOWN = 8;
/** 분류할 수 있는 국면 — 렌주 · 표준 15줄(§5). */
const CLASSIFIABLE = ["renju-15", "standard-15"];

export function LibraryDetail({
  entry,
  onBack,
}: {
  entry: LibraryMetaRow;
  onBack?: (() => void) | undefined;
}) {
  const navigate = useNavigate();
  const lib = useLibraryStore();
  const dbs = useDbStore();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(entry.title);
  const [covering, setCovering] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [allRoots, setAllRoots] = useState(false);
  const [busy, setBusy] = useState(false);

  const stats = entry.stats;
  const size = lib.sizes[entry.id] ?? 0;
  const scan = lib.scan?.id === entry.id ? lib.scan : null;
  const note = lib.notes[entry.id];
  const key = coverKeyOf(entry.cover, stats);
  const attached = dbs.active?.id === entry.id && dbs.status === "on";

  const go = async (moves: Parameters<typeof lib.open>[1], to: string) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const err = await lib.open(entry.id, moves);
    setBusy(false);
    if (err) return setNotice(err);
    navigate(to);
  };

  const openings = stats?.openings;
  const classified = openings ? openings.slice(0, COUNT).reduce((a, b) => a + b, 0) : 0;
  const unclassified = openings?.[COUNT] ?? 0;
  const hasClassifiable = !!stats && CLASSIFIABLE.some((k) => (stats.rules[k] ?? 0) > 0);
  // 미분류가 대부분이면 주형 분포를 접고 뿌리 국면을 위로(§6).
  const rootsFirst = !openings || unclassified > classified;
  const rows = openings
    ? openings
        .slice(0, COUNT)
        .map((n, i) => ({ i, n }))
        .filter((r) => r.n > 0)
        .sort((a, b) => b.n - a.n)
    : [];
  const maxRow = Math.max(1, ...rows.map((r) => r.n), unclassified);

  const openingSection = openings && classified > 0 && (
    <section className="panel libdetail__section" aria-label={t("주형 분포")}>
      <Disclosure
        id="lib-openings"
        level={3}
        defaultOpen={!rootsFirst}
        title={t("주형 분포")}
        summary={t("분류 {a} · 미분류 {b}", { a: fmtCount(classified), b: fmtCount(unclassified) })}
      >
        <ul className="libopenings">
          {rows.map((r) => (
            <li key={r.i}>
              <button
                type="button"
                className="libopenings__row"
                disabled={busy}
                onClick={() => void go(openingMoves(r.i), "/board")}
                title={t("{name} 대표 국면을 판에서 엽니다", { name: labelOf(r.i) })}
              >
                <DbCover k={r.i} />
                <span className="libopenings__name">
                  <b>{ABBR[r.i]}</b> {nameOf(r.i)}
                </span>
                <span className="libopenings__bar" aria-hidden="true">
                  <span data-cov={r.i} style={{ width: `${(r.n / maxRow) * 100}%` }} />
                </span>
                <span className="libopenings__n tnum">{fmtCount(r.n)}</span>
              </button>
            </li>
          ))}
          {unclassified > 0 && (
            <li className="libopenings__row libopenings__row--plain">
              <span className="libopenings__none" aria-hidden="true" />
              <span className="libopenings__name">{t("미분류")}</span>
              <span className="libopenings__bar" aria-hidden="true">
                <span style={{ width: `${(unclassified / maxRow) * 100}%` }} />
              </span>
              <span className="libopenings__n tnum">{fmtCount(unclassified)}</span>
            </li>
          )}
        </ul>
      </Disclosure>
    </section>
  );

  const roots = stats?.roots ?? [];
  const shownRoots = allRoots ? roots : roots.slice(0, ROOTS_SHOWN);
  const rootsSection = roots.length > 0 && (
    <section className="panel libdetail__section" aria-label={t("뿌리 국면")}>
      <h3 className="panel__title">{t("뿌리 국면")}</h3>
      <p className="panel__hint">
        {t("부모가 DB 에 없는 국면입니다. 아래로 이어진 국면이 많은 순서입니다.")}
      </p>
      <ul className="libroots">
        {shownRoots.map((r) => {
          const moves = movesOfKey(r.key, DEFAULT_SIZE);
          return (
            <li key={r.key}>
              <button
                type="button"
                className="libroots__row"
                disabled={busy || !moves}
                title={moves ? t("이 국면을 판에서 엽니다") : t("이 판 크기에서는 열 수 없습니다")}
                onClick={() => moves && void go(moves, "/board")}
              >
                {moves ? (
                  <PositionThumb moves={moves} size={DEFAULT_SIZE} />
                ) : (
                  <span className="posthumb" />
                )}
                <span className="libroots__text">
                  <span className="libroots__title">
                    {moves?.length === 0
                      ? t("빈 판")
                      : t("{n}수 국면", { n: moves?.length ?? "?" })}
                  </span>
                  <span className="libroots__sub tnum">
                    {t("아래 {n}", { n: positionsText(r.subtree) })}
                  </span>
                </span>
                <Icon d={ICON.chevron} className="libroots__chev" />
              </button>
            </li>
          );
        })}
      </ul>
      {roots.length > ROOTS_SHOWN && (
        <div className="panel__actions">
          <button type="button" onClick={() => setAllRoots((v) => !v)}>
            {allRoots ? t("줄이기") : t("모두 보기 ({n})", { n: roots.length })}
          </button>
        </div>
      )}
    </section>
  );

  const scanLine = !stats ? (
    scan ? (
      <div className="libdetail__scan" role="status">
        <span className="panel__hint">{t("통계를 세는 중…")}</span>
        <span className="lprogress">
          <span className="lprogress__bar">
            <span style={{ width: `${Math.round(scan.fraction * 100)}%` }} />
          </span>
          <span className="lprogress__value tnum">{Math.round(scan.fraction * 100)}%</span>
        </span>
        <div className="panel__actions">
          <button type="button" onClick={() => lib.cancelScan()}>
            {t("그만 세기")}
          </button>
        </div>
      </div>
    ) : size === 0 ? (
      <p className="panel__hint">{t("아직 비어 있습니다. 붙여서 쓰면 국면이 쌓입니다.")}</p>
    ) : note === "error" ? (
      <div>
        <p className="panel__hint">{t("이 파일의 통계를 세지 못했습니다.")}</p>
        <div className="panel__actions">
          <button type="button" onClick={() => lib.rescan(entry.id)}>
            {t("다시 세기")}
          </button>
        </div>
      </div>
    ) : (
      <p className="panel__hint">{t("통계를 셀 차례를 기다리는 중…")}</p>
    )
  ) : !stats.roots ? (
    <p className="panel__hint">{t("주형 · 뿌리 통계는 이 기기의 메모리로는 생략했습니다.")}</p>
  ) : hasClassifiable && !openings ? (
    <p className="panel__hint">
      {t("이 파일은 국면 순서가 엔진과 달라 주형을 정하지 않았습니다.")}
    </p>
  ) : null;

  const chips = [
    mainRule(stats?.rules),
    stats ? positionsText(stats.records) : null,
    size ? fmtBytes(size) : null,
    `${t("마지막 저장")} ${fmtDate(entry.updatedAt)}`,
  ].filter(Boolean) as string[];

  return (
    <div className="libdetail" data-cov={String(key)} data-k="library-detail">
      <header className="libdetail__head">
        {onBack && (
          <button
            type="button"
            className="iconbtn iconbtn--back libdetail__back"
            onClick={onBack}
            aria-label={t("뒤로")}
          >
            <Icon d={ICON.back} />
          </button>
        )}
        <button
          type="button"
          className="libdetail__cover"
          onClick={() => setCovering(true)}
          aria-label={t("커버 바꾸기")}
        >
          <DbCover k={key} seed={entry.cover.seed} />
        </button>
        <div className="libdetail__titles">
          <button
            type="button"
            className="libdetail__title"
            onClick={() => {
              setTitle(entry.title);
              setRenaming(true);
            }}
            title={t("이름 바꾸기")}
          >
            {entry.title}
          </button>
          <ul className="libdetail__chips">
            {chips.map((c) => (
              <li key={c} className="libchip tnum">
                {c}
              </li>
            ))}
            {attached && <li className="libchip libchip--on">{t("붙음")}</li>}
          </ul>
        </div>
        <div className="panel__actions libdetail__primary">
          <button
            type="button"
            className="button--primary"
            disabled={busy}
            data-k="library-open"
            onClick={() => void go(null, "/board")}
          >
            <Icon d={ICON.play} />
            {t("이 DB 열기")}
          </button>
        </div>
      </header>

      {notice && (
        <p className="panel__hint" role="alert">
          {notice}
        </p>
      )}
      {scanLine}

      {rootsFirst ? rootsSection : openingSection}
      {rootsFirst ? openingSection : rootsSection}

      <section className="panel libdetail__section" aria-label={t("열기")}>
        <h3 className="panel__title">{t("열기")}</h3>
        <p className="panel__hint">{t("통계가 없어도 늘 열 수 있습니다.")}</p>
        <div className="panel__actions">
          <button type="button" disabled={busy} onClick={() => void go([], "/board")}>
            {t("빈 판에서 열기")}
          </button>
          <button type="button" disabled={busy} onClick={() => void go(null, "/library/edit")}>
            {t("편집기로")}
          </button>
        </div>
      </section>

      {stats && (
        <section className="panel libdetail__section" aria-label={t("기록")}>
          <h3 className="panel__title">{t("기록")}</h3>
          <dl className="librecords tnum">
            <div>
              <dt>W</dt>
              <dd>{fmtCount(stats.labels.W)}</dd>
            </div>
            <div>
              <dt>L</dt>
              <dd>{fmtCount(stats.labels.L)}</dd>
            </div>
            <div>
              <dt>D</dt>
              <dd>{fmtCount(stats.labels.D)}</dd>
            </div>
            <div>
              <dt>{t("주석")}</dt>
              <dd>{fmtCount(stats.commented)}</dd>
            </div>
          </dl>
          {Object.keys(stats.rules).length > 1 && (
            <p className="panel__hint tnum">
              {Object.entries(stats.rules)
                .map(([k, n]) => `${ruleLabel(k)} ${fmtCount(n)}`)
                .join(" · ")}
            </p>
          )}
        </section>
      )}

      <section className="panel libdetail__section" aria-label={t("관리")}>
        <h3 className="panel__title">{t("관리")}</h3>
        <div className="panel__actions">
          <button type="button" onClick={() => setCovering(true)}>
            {t("커버 바꾸기")}
          </button>
          <button
            type="button"
            disabled={size === 0}
            onClick={() =>
              void lib.exportFile(entry.id).then((r) => {
                if ("error" in r) setNotice(r.error);
                else downloadBlob(r.name, r.file, "application/octet-stream");
              })
            }
          >
            {t(".db 내려받기")}
          </button>
          <button
            type="button"
            data-k="library-split"
            disabled={size === 0 || !!lib.job}
            onClick={() => setSplitting(true)}
          >
            <Icon d={ICON.split} />
            {t("나누기")}
          </button>
          <button
            type="button"
            className="btn--danger"
            data-k="library-trash"
            onClick={() =>
              // 지우기 = 휴지통(§7 ③) — 묻지 않고 옮기고, 화면 아래 10초 되돌리기.
              void lib.trash(entry.id).then((err) => {
                if (err) setNotice(err);
                else onBack?.();
              })
            }
          >
            {t("지우기")}
          </button>
        </div>
      </section>

      <Sheet
        open={renaming}
        title={t("이름 바꾸기")}
        onClose={() => setRenaming(false)}
        k="rename-sheet"
        actions={
          <>
            <button type="button" className="ghostbtn" onClick={() => setRenaming(false)}>
              {t("닫기")}
            </button>
            <button
              type="button"
              className="cta"
              disabled={!title.trim()}
              onClick={() => {
                void lib.rename(entry.id, title);
                setRenaming(false);
              }}
            >
              {t("확인")}
            </button>
          </>
        }
      >
        <label className="field field--wide">
          <span className="field__label">{t("이름")}</span>
          <span className="field__box">
            <input
              className="field__input field__input--text"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && title.trim()) {
                  void lib.rename(entry.id, title);
                  setRenaming(false);
                }
              }}
            />
          </span>
        </label>
        <p className="panel__hint">
          {t("이 브라우저의 DB 는 이름만 바뀝니다. 파일 이름은 따로 없습니다.")}
        </p>
      </Sheet>

      <SplitSheet
        entry={entry}
        open={splitting}
        onClose={() => setSplitting(false)}
        onDone={(made) => {
          setSplitting(false);
          setNotice(t("{n}개로 나눴습니다", { n: made.length }));
        }}
      />

      <CoverSheet
        entry={entry}
        open={covering}
        onClose={() => setCovering(false)}
        onSave={(cover) => void lib.setCover(entry.id, cover)}
      />
    </div>
  );
}
