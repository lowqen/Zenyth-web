import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageTitle } from "../../app/PageTitle";
import { useDesktopSplit } from "../../app/layout";
import { Chip, ChipGroup, Segmented } from "../../components/controls";
import { Disclosure } from "../../components/Disclosure";
import { Icon } from "../../components/icons";
import { ICON } from "../../components/icon-paths";
import type { LibraryMetaRow } from "../../data/library";
import { t } from "../../i18n/i18n";
import { useDbStore } from "../database/dbStore";
import { DbCover } from "./DbCover";
import { coverKeyOf } from "./cover";
import { fmtBytes, fmtDate, mainRule, positionsText } from "./format";
import { LibraryDetail } from "./LibraryDetail";
import { MergeSheet } from "./MergeSheet";
import { useLibraryStore, type LibrarySort } from "./libraryStore";

/**
 * 라이브러리(라이브러리 계획 §6 · L2) — DB 탭이 된 화면. 이 브라우저의 yixindb 파일을 커버 격자로 늘어놓고, 고르면
 * 상세(통계 · 열람 동선)를 본다. 엔진에 붙는 DB 는 한 번에 하나라 맨 위에 «지금 붙은 DB»(음악 앱의 «지금 재생 중»).
 *
 * - `/library` 격자, `/library/:id` 상세. 데스크톱 2열(`useDesktopSplit`)이면 두 주소 모두 격자 | 상세 인스펙터.
 * - 넓은 화면은 커버 hover 의 ▶ 가 바로 붙이기 — 판으로 간다.
 * - 국면 편집기(옛 DB 화면)는 `/library/edit`.
 */

const VIEW_KEY = "rapfi.library.view";
const UNDO_MS = 10_000;

interface ViewPrefs {
  sort: LibrarySort;
  list: boolean;
}

function readView(): ViewPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}") as Partial<ViewPrefs>;
    return {
      sort: v.sort === "name" || v.sort === "size" ? v.sort : "recent",
      list: v.list === true,
    };
  } catch {
    return { sort: "recent", list: false };
  }
}

function saveView(v: ViewPrefs) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    /* 이번 세션만 */
  }
}

export function LibraryScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const split = useDesktopSplit();
  const lib = useLibraryStore();
  const dbs = useDbStore();
  const [view, setView] = useState<ViewPrefs>(readView);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [merging, setMerging] = useState(false);
  // 길게 누르기(터치) — 0.5초면 고르기를 켜고 뒤따르는 클릭은 삼킨다
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const endPress = () => {
    if (press.current) clearTimeout(press.current.timer);
  };

  useEffect(() => {
    void useDbStore.getState().loadStored();
    void useLibraryStore.getState().load();
  }, []);

  // 10초 되돌리기 — 시간이 지나면 스낵바만 걷는다(휴지통에는 30일 남는다).
  const undo = lib.undo;
  useEffect(() => {
    if (!undo) return;
    const left = undo.at + UNDO_MS - Date.now();
    const timer = setTimeout(() => useLibraryStore.setState({ undo: null }), Math.max(0, left));
    return () => clearTimeout(timer);
  }, [undo]);

  const sorted = useMemo(() => {
    const rows = [...lib.entries];
    if (view.sort === "name") rows.sort((a, b) => a.title.localeCompare(b.title));
    else if (view.sort === "size")
      rows.sort((a, b) => (lib.sizes[b.id] ?? 0) - (lib.sizes[a.id] ?? 0));
    return rows;
  }, [lib.entries, lib.sizes, view.sort]);

  const setPrefs = (p: Partial<ViewPrefs>) => {
    const next = { ...view, ...p };
    setView(next);
    saveView(next);
  };

  const selected = id ? (lib.entries.find((e) => e.id === id) ?? null) : null;
  const active = dbs.active ? (lib.entries.find((e) => e.id === dbs.active!.id) ?? null) : null;
  // 2열은 고른 것이 없으면 붙은 DB 를 보인다.
  const detail = selected ?? (split ? active : null);

  const openDetail = (e: LibraryMetaRow) =>
    navigate(`/library/${e.id}`, { replace: split && !!id });
  const selecting = lib.selected.length > 0;
  const quickOpen = async (e: LibraryMetaRow) => {
    setNotice(null);
    const err = await lib.open(e.id, null);
    if (err) setNotice(err);
    else navigate("/board");
  };

  // 좁은 화면(2열이 아닌)의 상세는 자기 화면이다.
  if (!split && id) {
    if (!lib.loaded) return <div className="library" />;
    if (!selected)
      return (
        <div className="library">
          <p className="panel__hint">{t("라이브러리에 없는 DB 입니다")}</p>
        </div>
      );
    return (
      <div className="library library--detail">
        <LibraryDetail entry={selected} onBack={() => void navigate("/library")} />
        <UndoBar />
      </div>
    );
  }

  const status =
    dbs.status === "on"
      ? dbs.dirty && !dbs.settings.readonly
        ? t("저장 안 된 변경")
        : t("저장됨")
      : dbs.status === "attaching"
        ? t("붙이는 중…")
        : dbs.status === "error"
          ? t("붙이지 못함")
          : t("꺼짐");

  const grid = (
    <div className="library__main">
      <PageTitle>{t("라이브러리")}</PageTitle>
      <div className="library__bar">
        <ChipGroup label={t("소스")} row>
          <Chip on onClick={() => undefined}>
            {t("이 브라우저")}
          </Chip>
        </ChipGroup>
        <div className="panel__actions library__actions">
          <button type="button" data-k="library-import" onClick={() => fileInput.current?.click()}>
            <Icon d={ICON.fileOpen} />
            {t("가져오기")}
          </button>
          <button
            type="button"
            data-k="library-new"
            onClick={() =>
              void lib.create(t("새 DB")).then((e) => e && navigate(`/library/${e.id}`))
            }
          >
            <Icon d={ICON.plus} />
            {t("새 DB")}
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".db,application/octet-stream"
          hidden
          onChange={(ev) => {
            const f = ev.currentTarget.files?.[0];
            ev.currentTarget.value = "";
            if (!f) return;
            void lib
              .importFile(f)
              .then((err) => setNotice(err ?? t("{name} 을(를) 가져왔습니다", { name: f.name })));
          }}
        />
      </div>

      {notice && (
        <p className="panel__hint" role="status" data-k="library-notice">
          {notice}{" "}
          <button type="button" className="linkish" onClick={() => setNotice(null)}>
            {t("닫기")}
          </button>
        </p>
      )}

      {active && (
        <section className="panel libnow" aria-label={t("지금 붙은 DB")} data-k="library-now">
          <h2 className="panel__title libnow__label">{t("지금 붙은 DB")}</h2>
          <div className="libnow__body">
            <DbCover k={coverKeyOf(active.cover, active.stats)} seed={active.cover.seed} />
            <div className="libnow__text">
              <p className="libnow__title">
                {active.title}
                <span className="libnow__status" data-status={dbs.status}>
                  {status}
                </span>
              </p>
              <p className="libnow__sub tnum">{subtitle(active, lib.sizes[active.id] ?? 0)}</p>
              <div className="panel__actions">
                <button type="button" className="button--tonal" onClick={() => openDetail(active)}>
                  {t("기보 보기")}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {selecting ? (
        <div className="libselect" role="toolbar" aria-label={t("고른 DB")} data-k="library-select">
          <span className="libselect__count tnum">
            {t("{n}개 선택", { n: lib.selected.length })}
          </span>
          <div className="panel__actions panel__actions--compact">
            <button
              type="button"
              className="button--primary"
              data-k="library-merge"
              disabled={lib.selected.length < 2 || !!lib.job}
              onClick={() => setMerging(true)}
            >
              <Icon d={ICON.merge} />
              {t("합치기")}
            </button>
            <button
              type="button"
              className="btn--danger"
              onClick={() => void lib.trashMany(lib.selected).then((err) => err && setNotice(err))}
            >
              {t("지우기")}
            </button>
            <button type="button" className="ghostbtn" onClick={lib.clearSelection}>
              {t("취소")}
            </button>
          </div>
        </div>
      ) : (
        <div className="library__tools">
          <Segmented
            label={t("정렬")}
            value={view.sort}
            options={[
              { value: "recent", label: t("최근") },
              { value: "name", label: t("이름") },
              { value: "size", label: t("크기") },
            ]}
            onChange={(sort) => setPrefs({ sort })}
          />
          <Segmented
            label={t("보기")}
            value={view.list ? "list" : "grid"}
            options={[
              { value: "grid", label: t("격자") },
              { value: "list", label: t("목록") },
            ]}
            onChange={(v) => setPrefs({ list: v === "list" })}
          />
        </div>
      )}

      {lib.loaded && sorted.length === 0 && (
        <p className="panel__hint">{t("아직 DB 가 없습니다. 가져오거나 새로 만드세요.")}</p>
      )}

      <ul className={view.list ? "libgrid libgrid--list" : "libgrid"} data-k="library-grid">
        {sorted.map((e) => {
          const on = dbs.active?.id === e.id && dbs.status === "on";
          const scanning = lib.scan?.id === e.id;
          const picked = lib.selected.includes(e.id);
          const working = lib.job?.ids.includes(e.id) ?? false;
          return (
            <li
              key={e.id}
              className="libgrid__item"
              data-on={on || undefined}
              data-picked={picked || undefined}
              data-selecting={selecting || undefined}
            >
              <button
                type="button"
                className="libgrid__card"
                aria-current={detail?.id === e.id ? "true" : undefined}
                aria-pressed={selecting ? picked : undefined}
                onPointerDown={(ev) => {
                  if (ev.pointerType === "mouse") return;
                  endPress();
                  const p = { timer: 0, x: ev.clientX, y: ev.clientY, fired: false };
                  p.timer = window.setTimeout(() => {
                    p.fired = true;
                    lib.toggleSelect(e.id);
                  }, 500);
                  press.current = p;
                }}
                onPointerMove={(ev) => {
                  const p = press.current;
                  if (p && Math.hypot(ev.clientX - p.x, ev.clientY - p.y) > 10) endPress();
                }}
                onPointerUp={endPress}
                onPointerCancel={endPress}
                onContextMenu={(ev) => {
                  if (press.current?.fired || selecting) ev.preventDefault();
                }}
                onClick={() => {
                  if (press.current?.fired) {
                    press.current = null;
                    return;
                  }
                  if (selecting) lib.toggleSelect(e.id);
                  else void openDetail(e);
                }}
              >
                <DbCover k={coverKeyOf(e.cover, e.stats)} seed={e.cover.seed} />
                <span className="libgrid__text">
                  <span className="libgrid__title">{e.title}</span>
                  <span className="libgrid__sub tnum">
                    {scanning
                      ? t("세는 중 {p}%", { p: Math.round((lib.scan?.fraction ?? 0) * 100) })
                      : subtitle(e, lib.sizes[e.id] ?? 0)}
                  </span>
                </span>
                {on && <span className="libgrid__on">{t("붙음")}</span>}
                {working && <span className="libgrid__on libgrid__busy">{t("작업 중")}</span>}
              </button>
              <button
                type="button"
                role="checkbox"
                aria-checked={picked}
                className="libgrid__check"
                aria-label={t("{title} 고르기", { title: e.title })}
                onClick={() => lib.toggleSelect(e.id)}
              >
                <Icon d={ICON.check} />
              </button>
              {!on && !selecting && (
                <button
                  type="button"
                  className="libgrid__play"
                  aria-label={t("{title} 붙이고 판으로", { title: e.title })}
                  title={t("붙이고 판으로")}
                  onClick={() => void quickOpen(e)}
                >
                  <Icon d={ICON.play} />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <MergeSheet
        ids={lib.selected}
        open={merging}
        onClose={() => setMerging(false)}
        onDone={(made) => {
          setMerging(false);
          setNotice(t("«{name}» 로 합쳤습니다", { name: made.title }));
          void navigate(`/library/${made.id}`, { replace: split && !!id });
        }}
      />

      {lib.trashed.length > 0 && (
        <div className="panel__fold">
          <Disclosure id="lib-trash" level={3} title={t("휴지통 ({n})", { n: lib.trashed.length })}>
            <p className="panel__hint">{t("30일이 지나면 저절로 지워집니다.")}</p>
            <ul className="libtrash">
              {lib.trashed.map((e) => (
                <li key={e.id} className="libtrash__row">
                  <span className="libtrash__title">{e.title}</span>
                  <span className="libtrash__date tnum">{fmtDate(e.trashedAt!)}</span>
                  <span className="panel__actions panel__actions--compact">
                    <button type="button" onClick={() => void lib.restore(e.id)}>
                      {t("되돌리기")}
                    </button>
                    <button
                      type="button"
                      className="btn--danger"
                      onClick={() => void lib.purge(e.id)}
                    >
                      {t("아주 지우기")}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </Disclosure>
        </div>
      )}
    </div>
  );

  if (!split)
    return (
      <div className="library">
        {grid}
        <UndoBar />
      </div>
    );
  return (
    <div className="library" data-split>
      {grid}
      <div className="library__side">
        {detail ? (
          <LibraryDetail
            key={detail.id}
            entry={detail}
            onBack={id ? () => void navigate("/library") : undefined}
          />
        ) : (
          <p className="panel__hint">{t("왼쪽에서 DB 를 고르세요.")}</p>
        )}
      </div>
      <UndoBar />
    </div>
  );
}

/** 카드의 부제 — 국면 수(세었으면) · 아니면 크기 · 비었으면 «비어 있음». */
function subtitle(e: LibraryMetaRow, size: number): string {
  if (e.stats) {
    const rule = mainRule(e.stats.rules);
    return [positionsText(e.stats.records), rule].filter(Boolean).join(" · ");
  }
  return size ? fmtBytes(size) : t("비어 있음");
}

/** 지운 뒤 10초 — [되돌리기]. */
function UndoBar() {
  const undo = useLibraryStore((s) => s.undo);
  const restore = useLibraryStore((s) => s.restore);
  if (!undo) return null;
  return (
    <div className="libundo" role="status" data-k="library-undo">
      <span>{t("«{title}» 을(를) 휴지통으로 옮겼습니다", { title: undo.title })}</span>
      <button
        type="button"
        className="linkish"
        onClick={() => void Promise.all(undo.ids.map((id) => restore(id)))}
      >
        {t("되돌리기")}
      </button>
    </div>
  );
}
