import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../components/icons";
import { ICON } from "../components/icon-paths";
import { MiniBoard } from "../components/MiniBoard";
import { Sheet } from "../components/Sheet";
import { ZenythMark } from "../components/ZenythMark";
import { setLang, t, useLang, type Lang } from "../i18n/i18n";
import { NAV_ICON } from "./destinations";
import { RELEASE_NAME, useFirstVisit } from "./firstVisit";
import { RELEASE_NOTES } from "./releaseNotes";

/**
 * 이름 · 첫 실행(Z8) — 앱 `SetupScreen`(환영) · `TourScreen`(둘러보기) · `WhatsNew`(새로워진 점)를 옮긴 것.
 * 셋 다 셸 밖(`Root`)에 걸려 화면 전체를 덮는다. 웹에 없는 단계(알림 권한)는 뺐다.
 */

const LANGS: readonly { value: Lang; label: string }[] = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "English" },
];

/** 아이콘 타일 + 제목 · 설명(앱 `FeatureRow`). 제목이 없으면 설명이 제목 크기로. */
function FeatureRow({ icon, title, text }: { icon: string; title?: string; text: string }) {
  return (
    <li className="feature">
      <span className="icontile" aria-hidden="true">
        <Icon d={icon} />
      </span>
      {title ? (
        <span className="feature__text">
          <b>{title}</b>
          <span>{text}</span>
        </span>
      ) : (
        <span className="feature__solo">{text}</span>
      )}
    </li>
  );
}

/**
 * 처음 온 사람의 한 화면 — 앱의 첫 단계(마크 · 이름 · 한 줄)와 둘러보기 첫 쪽(앱이 하는 세 가지)을 하나로.
 * 끝내기 전에는 엔진을 띄우지 않는다(`useAutoBoot`). 위 왼쪽의 언어 알약은 앱처럼 언어 시트를 연다.
 */
export function WelcomeScreen() {
  const welcomed = useFirstVisit((s) => s.welcomed);
  const finish = useFirstVisit((s) => s.finishWelcome);
  const lang = useLang((s) => s.lang);
  const [choosing, setChoosing] = useState(false);
  if (welcomed) return null;
  return (
    <div
      className="onboard"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      data-k="welcome"
    >
      <div className="onboard__top">
        <button type="button" className="langpill" onClick={() => setChoosing(true)}>
          <Icon d={ICON.language} />
          <span lang={lang}>{LANGS.find((l) => l.value === lang)?.label}</span>
          <span className="sr-only">{t("언어 선택")}</span>
        </button>
      </div>
      <div className="onboard__scroll">
        <div className="onboard__col onboard__col--center">
          <ZenythMark size={88} />
          <h1 id="welcome-title" className="onboard__welcome">
            {t("Zenyth Web 에 오신 것을 환영합니다")}
          </h1>
          <p className="onboard__lead">{t("브라우저 안에서 도는 진짜 오목 · 렌주 엔진")}</p>
          <ul className="onboard__features">
            <FeatureRow
              icon={NAV_ICON.engineOn}
              text={t("엔진이 브라우저 안에서 돌아 서버 · 계정 없이 동작합니다")}
            />
            <FeatureRow
              icon={ICON.block}
              text={t("렌주 금수(삼삼 · 사사 · 장련)를 엔진이 직접 판정합니다")}
            />
            <FeatureRow
              icon={ICON.lock}
              text={t("기보 · 정석 · 통계는 이 브라우저 안에만 남습니다")}
            />
          </ul>
        </div>
      </div>
      <div className="onboard__foot">
        <button type="button" className="cta onboard__go" onClick={finish} data-k="welcome-start">
          {t("시작하기")}
        </button>
      </div>
      <Sheet
        open={choosing}
        title={t("언어 선택")}
        onClose={() => setChoosing(false)}
        actions={
          <button type="button" className="ghostbtn" onClick={() => setChoosing(false)}>
            {t("닫기")}
          </button>
        }
      >
        <p className="sheet__text">{t("쓸 언어를 고르세요. 나중에 설정에서 바꿀 수 있습니다")}</p>
        <div className="radiorows" role="radiogroup" aria-label={t("언어")}>
          {LANGS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={lang === o.value}
              lang={o.value}
              className="radiorow"
              onClick={() => {
                setLang(o.value);
                setChoosing(false);
              }}
            >
              <span className="radiorow__label">{o.label}</span>
              <span className="checkcircle" aria-hidden="true">
                <Icon d={ICON.check} />
              </span>
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

type Row = { icon: string; title: string; text: string };

interface TourPage {
  icon: string;
  title: string;
  body: string;
  picture?: ReactNode;
  rows: Row[];
}

/** 다섯 돌 — 판이 벌어진 것으로 읽힐 만큼(앱 `SampleStones`). */
const SAMPLE = [
  { x: 7, y: 7 },
  { x: 8, y: 6 },
  { x: 9, y: 7 },
  { x: 8, y: 7 },
  { x: 8, y: 8 },
];

function tourPages(): TourPage[] {
  return [
    {
      icon: NAV_ICON.boardOn,
      title: t("두고 분석하기"),
      body: t("보드는 [분석] · [대국] 두 탭입니다. 판이 따로라 섞이지 않고, 둘 다 자동 저장됩니다"),
      picture: (
        <div className="tourpic" aria-hidden="true">
          <MiniBoard moves={SAMPLE} className="tourpic__board" />
          <div className="tourpic__text">
            <span className="tourpic__label">{t("최선수")}</span>
            <span className="tourpic__best">J10</span>
            <span className="pillbadge pillbadge--accent">{t("승률 71% · 깊이 18")}</span>
          </div>
        </div>
      ),
      rows: [
        {
          icon: ICON.palette,
          title: t("값은 글자색으로"),
          text: t("따뜻한 빨강일수록 이기는 수, 차가운 파랑일수록 지는 수입니다"),
        },
        {
          icon: ICON.fileOpen,
          title: t("기보"),
          text: t("열기 · .psq/.sav 저장 · 링크 복사 · 이미지로 내보내기"),
        },
      ],
    },
    {
      icon: NAV_ICON.researchOn,
      title: t("연구하기"),
      body: t("판 밖에서 국면과 오프닝을 깊이 파고듭니다"),
      rows: [
        {
          icon: ICON.history,
          title: t("게임 리뷰"),
          text: t("끝난 판을 되짚으며 평가가 뒤집힌 지점을 짚어 줍니다"),
        },
        {
          icon: ICON.explore,
          title: t("오프닝 익스플로러"),
          text: t("주형 이름 249개와 흑 5수 유불리를 판 위에 보여 줍니다"),
        },
        {
          icon: ICON.leaderboard,
          title: t("국면 증명 · 랭킹"),
          text: t("평가가 아니라 증명을 시키고, 26주형을 견줘 봅니다"),
        },
      ],
    },
    {
      icon: NAV_ICON.joseki,
      title: t("정석"),
      body: t("정해진 수순을 배우고, 내 정석을 모읍니다"),
      rows: [
        {
          icon: ICON.school,
          title: t("공식 커리큘럼"),
          text: t("레슨마다 살펴보고, 수순을 직접 맞히며 익힙니다"),
        },
        {
          icon: ICON.bookmarks,
          title: t("내 정석"),
          text: t("갈래 · 평가 기호 · 메모를 달고, 대칭까지 찾습니다"),
        },
        {
          icon: ICON.link,
          title: t("레슨 링크"),
          text: t("레슨마다 주소가 있어 그대로 주고받습니다. 앱에서도 열립니다"),
        },
      ],
    },
    {
      icon: NAV_ICON.engineOn,
      title: t("엔진"),
      body: t("화면 위 엔진 칩이 상태를 보여 줍니다. 꺼져 있으면 눌러서 켭니다"),
      rows: [
        {
          icon: ICON.memory,
          title: t("브라우저 안의 Rapfi"),
          text: t("WebAssembly 로 돌고, 격리된 페이지에서는 여러 스레드를 씁니다"),
        },
        {
          icon: ICON.inventory2,
          title: t("엔진 DB"),
          text: t(
            "엔진이 배운 국면을 남겨 두고 다음에 이어 씁니다. 고급 사용자 모드의 DB 탭에서 봅니다",
          ),
        },
      ],
    },
  ];
}

/**
 * 네 장소 둘러보기 — 설정 ▸ 정보에서만 연다(앱 O3). 위에 뒤로 · 건너뛰기, 쪽, 점, 넓은 알약 하나.
 * ← → 로 쪽을 넘기고 Esc 로 닫는다.
 */
export function TourScreen() {
  const open = useFirstVisit((s) => s.tour);
  return open ? <Tour /> : null;
}

function Tour() {
  const close = useFirstVisit((s) => s.closeTour);
  const [page, setPage] = useState(0);
  const pages = tourPages();
  const last = page === pages.length - 1;
  const p = pages[page]!;
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    root.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") setPage((n) => Math.min(n + 1, pages.length - 1));
      else if (e.key === "ArrowLeft") setPage((n) => Math.max(n - 1, 0));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [close, pages.length]);

  return (
    <div
      ref={root}
      className="onboard"
      role="dialog"
      aria-modal="true"
      aria-label={t("둘러보기")}
      tabIndex={-1}
      data-k="tour"
      data-page={page}
    >
      <div className="onboard__top">
        {page > 0 ? (
          <button
            type="button"
            className="iconbtn iconbtn--back"
            aria-label={t("이전")}
            onClick={() => setPage(page - 1)}
          >
            <Icon d={ICON.back} />
          </button>
        ) : (
          <span />
        )}
        {!last && (
          <button type="button" className="ghostbtn onboard__skip" onClick={close}>
            {t("건너뛰기")}
          </button>
        )}
      </div>
      <div className="onboard__scroll" key={page}>
        <div className="onboard__col onboard__page">
          <span className="gamedata__hero" aria-hidden="true">
            <Icon d={p.icon} />
          </span>
          <h1 className="onboard__title">{p.title}</h1>
          <p className="onboard__lead">{p.body}</p>
          {p.picture}
          <ul className="onboard__features">
            {p.rows.map((r) => (
              <FeatureRow key={r.title} icon={r.icon} title={r.title} text={r.text} />
            ))}
          </ul>
        </div>
      </div>
      <div className="onboard__foot">
        <div className="pagedots" role="tablist" aria-label={t("쪽")}>
          {pages.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === page}
              aria-label={t("{n}쪽", { n: i + 1 })}
              className="pagedots__dot"
              onClick={() => setPage(i)}
            />
          ))}
        </div>
        <button
          type="button"
          className="cta onboard__go"
          onClick={() => (last ? close() : setPage(page + 1))}
        >
          {last ? t("완료") : t("다음")}
        </button>
      </div>
    </div>
  );
}

const RELEASES_URL = "https://github.com/lowqen/Zenyth-web/commits/main";

/**
 * 새로워진 점 — 전에 온 사람이 새 배포를 처음 열 때 한 번(앱 `WhatsNewOnUpdate`), 그리고 설정 ▸ 정보에서
 * 언제든. 마크 · «새로워진 점» · 두 줄 환영 · ✕, 환영 한 문장과 제목 붙은 짧은 묶음, 아래로 더 있으면 흐려짐,
 * 채운 알약 하나와 전체 기록 링크.
 */
export function WhatsNewWindow() {
  const open = useFirstVisit((s) => s.whatsNew && s.welcomed);
  const close = useFirstVisit((s) => s.closeWhatsNew);
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      d.focus();
      const b = body.current;
      if (b) setMore(b.scrollHeight - b.scrollTop - b.clientHeight > 2);
    } else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="whatsnew"
      tabIndex={-1}
      aria-labelledby="whatsnew-title"
      data-k="whatsnew"
      onClose={() => open && close()}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div className="whatsnew__card">
        <header className="whatsnew__head">
          <ZenythMark size={44} />
          <div className="whatsnew__titles">
            <span className="whatsnew__kicker">{t("새로워진 점")}</span>
            <h2 id="whatsnew-title" className="whatsnew__title">
              {t("Zenyth Web {v}에 오신 것을 환영합니다", { v: RELEASE_NAME })}
            </h2>
          </div>
          <button type="button" className="iconbtn" aria-label={t("닫기")} onClick={close}>
            <Icon d={ICON.close} />
          </button>
        </header>
        <div
          ref={body}
          className={"whatsnew__body" + (more ? " has-more" : "")}
          onScroll={(e) => {
            const b = e.currentTarget;
            setMore(b.scrollHeight - b.scrollTop - b.clientHeight > 2);
          }}
        >
          <p className="whatsnew__intro">{t(RELEASE_NOTES.intro)}</p>
          {RELEASE_NOTES.groups.map((g) => (
            <section key={g.title} className="whatsnew__group">
              <h3>{t(g.title)}</h3>
              <ul>
                {g.items.map((it) => (
                  <li key={it}>{t(it)}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <footer className="whatsnew__foot">
          <a className="ghostbtn" href={RELEASES_URL} target="_blank" rel="noreferrer noopener">
            {t("전체 변경 기록")}
          </a>
          <button type="button" className="cta" onClick={close}>
            {t("시작하기")}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
