import type { ReactNode } from "react";
import engineManifest from "../../engine/engine-manifest.json";
import { msg, t } from "../../i18n/i18n";
import { ZenythMark } from "../../components/ZenythMark";
import { RELEASE_NAME, useFirstVisit } from "../../app/firstVisit";
import { IS_DESKTOP } from "../../app/desktop/platform";
import { downloadProgress, useUpdateStore, type UpdatePhase } from "../../app/desktop/updateStore";

/**
 * 설정 ▸ 정보 — GPLv3 §0 · §5(d) 의 «적절한 법적 고지»(Appropriate Legal Notices).
 *
 * 대화형 화면이 있는 GPL 프로그램은 화면에서 저작권 고지 · 무보증 · 라이선스 조건과 그 전문을 볼
 * 방법을 알려야 한다. 배포물에 Rapfi(GPL-3.0-or-later)가 들어 있으므로 앱 전체가 그 대상이다.
 * 함께 싣거나 이식한 구성요소와 엔진의 대응 소스(업스트림 커밋 + `tools/patches/`)도 여기서
 * 가리킨다. 자세한 표와 BSD 고지 전문은 저장소의 `THIRD_PARTY_NOTICES.md` 가 정본이다.
 *
 * 구성요소 이름 · 라이선스 식별자는 번역하지 않는다(고유 명사 · SPDX).
 *
 * 설정 묶음(`.sgroup`)이 아니다 — 머리 모양만 빌려 쓰고 카드 클래스는 따로 둔다(스모크가
 * `.sgroup` 수로 설정 카드를 센다).
 */

const REPO = "https://github.com/lowqen/Zenyth-web";
const UPSTREAM = engineManifest.upstream;

interface Component {
  name: string;
  href: string;
  /** 사전 열쇠 — 그릴 때 `t()`. */
  role: string;
  license: string;
}

/**
 * 데스크톱이 동봉하는 네이티브 Rapfi — 공식 릴리스를 손대지 않고 싣는다(desktop.yml `RAPFI_NATIVE_TAG`).
 * 대응 소스는 그 릴리스의 태그다. 설치 폴더 `engine/SOURCE.txt` 에도 같은 안내가 있다.
 */
const RAPFI_NATIVE_TAG = "250615";

const NATIVE_RAPFI: Component = {
  name: `Rapfi ${RAPFI_NATIVE_TAG}`,
  href: `https://github.com/dhbloo/rapfi/releases/tag/${RAPFI_NATIVE_TAG}`,
  role: msg("탐색 엔진(데스크톱 네이티브 빌드 · 공식 릴리스)"),
  license: "GPL-3.0-or-later",
};

const WASM_RAPFI: Component = {
  name: "Rapfi",
  href: "https://github.com/dhbloo/rapfi",
  role: msg("탐색 엔진(WebAssembly 빌드)"),
  license: "GPL-3.0-or-later",
};

const COMPONENTS: readonly Component[] = [
  // 데스크톱은 WASM 을 싣지 않는다(desktop.yml «WASM 엔진 빼기»).
  IS_DESKTOP ? NATIVE_RAPFI : WASM_RAPFI,
  {
    name: "rapfi-networks",
    href: "https://github.com/dhbloo/rapfi-networks",
    role: msg("엔진 가중치"),
    license: "CC0-1.0",
  },
  {
    name: "Yixin-Board © 2009-2017 Kai Sun",
    href: "https://github.com/accreator/Yixin-Board",
    role: msg("이식한 데스크톱 로직(프로토콜 · 국면 키 · 설정 · 리뷰)"),
    license: "BSD-2-Clause",
  },
  {
    name: "Zenyth",
    href: "https://github.com/lowqen/Zenyth",
    role: msg("이식 원본 안드로이드 앱"),
    license: "BSD-2-Clause",
  },
  {
    name: "React · React Router · Zustand",
    href: "https://react.dev/",
    role: msg("화면 라이브러리"),
    license: "MIT",
  },
  {
    name: "Dexie.js",
    href: "https://dexie.org/",
    role: msg("저장 라이브러리(IndexedDB)"),
    license: "Apache-2.0",
  },
  {
    name: "Pretendard © 2021 Kil Hyung-jin",
    href: "https://github.com/orioncactus/pretendard",
    role: msg("본문 글꼴"),
    license: "OFL-1.1",
  },
  {
    name: "Material Icons © Google",
    href: "https://github.com/google/material-design-icons",
    role: msg("아이콘 경로"),
    license: "Apache-2.0",
  },
];

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="linkish" href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

/** 마크 · 이름 · 한 줄 · 판, 그리고 바뀐 점(Z8 — 앱 `AboutDialog`). */
function Brand() {
  const openWhatsNew = useFirstVisit((s) => s.openWhatsNew);
  return (
    <section className="panel about__brand" aria-label="Zenyth Web">
      <div className="about__brandhead">
        <ZenythMark size={56} />
        <div className="about__brandtext">
          <p className="about__appname">Zenyth Web</p>
          <p className="about__tagline">{t("오목 · 렌주 분석 · Rapfi 엔진 사용")}</p>
          <p className="about__version tnum">{t("버전 {v}", { v: RELEASE_NAME })}</p>
        </div>
      </div>
      <p className="about__intro">
        {t(
          "Rapfi 엔진을 브라우저 안에서 돌리는 오목 · 렌주 분석반입니다. Zenyth 앱의 웹판이며, 2026년 10월까지의 이름은 RapfiWeb 였습니다.",
        )}
      </p>
      <div className="about__actions">
        <button
          type="button"
          className="btn btn--tonal"
          onClick={openWhatsNew}
          data-k="open-whatsnew"
        >
          {t("이번 버전에서 바뀐 점")}
        </button>
      </div>
    </section>
  );
}

export function AboutPanel() {
  return (
    <>
      <Brand />
      {IS_DESKTOP && <DesktopRelease />}
      <AboutLegal />
    </>
  );
}

/** 셸 안에서만 받는다 — 웹 번들은 `@tauri-apps/plugin-updater` 를 싣지 않는다. */
const loadUpdater = () => import("../../app/desktop/updater");

function updateStatus(phase: UpdatePhase, portable: boolean): string {
  switch (phase.kind) {
    case "idle":
      return t("새 버전은 앱을 열 때 확인합니다");
    case "checking":
      return t("확인하는 중…");
    case "latest":
      return t("최신 버전입니다");
    case "available":
      return portable
        ? t("새 버전 {v} 이 있습니다. 포터블판은 릴리스에서 직접 받아 폴더를 바꿉니다", {
            v: phase.version,
          })
        : t("새 버전 {v} 을 설치할 수 있습니다", { v: phase.version });
    case "downloading":
      return t("받는 중 {p}", { p: downloadProgress(phase.done, phase.total) });
    case "installing":
      return t("설치 프로그램을 엽니다. 앱이 곧 닫힙니다");
    case "error":
      return phase.message;
  }
}

/**
 * 데스크톱 판 · 자동 업데이트(데스크톱 Z7). 설치는 사용자가 누를 때만 한다 — 분석 중에 앱이 저절로 닫히면 안 된다.
 * 포터블판은 설치판을 따로 깔게 되므로 릴리스 쪽만 가리킨다.
 */
function DesktopRelease() {
  const version = useUpdateStore((s) => s.appVersion);
  const portable = useUpdateStore((s) => s.portable);
  const phase = useUpdateStore((s) => s.phase);
  const busy =
    phase.kind === "checking" || phase.kind === "downloading" || phase.kind === "installing";
  const canInstall = phase.kind === "available" && !portable;
  return (
    <section className="panel about" aria-labelledby="sg-desktop" data-k="desktop-release">
      <header className="sgroup__head">
        <h2 id="sg-desktop" className="sgroup__title">
          Zenyth Desktop
        </h2>
        <p className="sgroup__desc tnum">
          {t("버전 {v}", { v: version ?? "—" })}
          {portable ? ` · ${t("포터블")}` : ""}
        </p>
      </header>
      <p className="about__intro tnum" role="status" aria-live="polite">
        {updateStatus(phase, portable)}
      </p>
      <div className="about__actions">
        {canInstall ? (
          <button
            type="button"
            className="btn btn--tonal"
            disabled={busy}
            onClick={() => void loadUpdater().then((m) => m.installUpdate())}
          >
            {t("설치하고 다시 시작")}
          </button>
        ) : (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void loadUpdater().then((m) => m.checkForUpdate(true))}
          >
            {t("업데이트 확인")}
          </button>
        )}
        {phase.kind === "available" && portable ? (
          <Ext href={`${REPO}/releases/tag/desktop-v${phase.version}`}>{t("릴리스 열기")}</Ext>
        ) : null}
      </div>
    </section>
  );
}

function AboutLegal() {
  return (
    <section className="panel about" aria-labelledby="sg-about">
      <header className="sgroup__head">
        <h2 id="sg-about" className="sgroup__title">
          {t("정보")}
        </h2>
        <p className="sgroup__desc">Zenyth Web · © 2026 lowqen</p>
      </header>

      <div className="about__body">
        <p>
          {t(
            "Zenyth Web 은 자유 소프트웨어입니다. GNU 일반 공중 사용 허가서(GPL) 3판 또는 그 이후 판의 조건에 따라 다시 배포하거나 고칠 수 있습니다.",
          )}
        </p>
        <p className="about__warranty">
          {t(
            "이 프로그램은 쓸모 있기를 바라며 배포되지만, 상품성이나 특정 목적 적합성에 대한 묵시적 보증을 포함해 어떠한 보증도 하지 않습니다.",
          )}
        </p>
        <p className="about__links">
          <Ext href={REPO}>{t("소스 코드")}</Ext>
          <Ext href={`${REPO}/blob/main/LICENSE`}>{t("라이선스 전문")}</Ext>
          <Ext href={`${REPO}/blob/main/THIRD_PARTY_NOTICES.md`}>{t("서드파티 고지")}</Ext>
        </p>
      </div>

      <h3 className="about__subtitle">{t("구성 요소")}</h3>
      <ul className="about__list">
        {COMPONENTS.map((c) => (
          <li key={c.name} className="about__item">
            <span className="about__name">
              <Ext href={c.href}>{c.name}</Ext>
            </span>
            <span className="about__role">{t(c.role)}</span>
            <code className="srow__key about__license">{c.license}</code>
          </li>
        ))}
      </ul>

      <p className="about__source">
        {t("엔진 소스")}:{" "}
        <Ext href={`https://github.com/dhbloo/rapfi/tree/${UPSTREAM}`}>
          dhbloo/rapfi@{UPSTREAM.slice(0, 8)}
        </Ext>{" "}
        + <Ext href={`${REPO}/tree/main/tools/patches`}>tools/patches</Ext>{" "}
        <span className="about__tag tnum">({engineManifest.tag})</span>
      </p>
    </section>
  );
}
