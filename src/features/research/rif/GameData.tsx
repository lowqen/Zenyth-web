import { Icon } from "../../../components/icons";
import { ICON } from "../../../components/icon-paths";
import { Sheet } from "../../../components/Sheet";
import { SmoothFill } from "../../../components/SmoothFill";
import { t } from "../../../i18n/i18n";
import { RIF_PHASE_TEXT } from "./protocol";
import { RENJUNET_DOWNLOADS, fmtInt } from "./format";
import { pickRifFile, useRifStore } from "./rifStore";
import { gameDataForm, gameDataSheetDue, useGameDataPrefs } from "./gameDataPrompt";

/**
 * 연구 탭(오프닝 · 랭킹)을 RenjuNet 대국 데이터로 이끄는 안내 — 앱 `GameDataPrompt.kt`(R2)를 옮긴 것.
 * 예전 카드(«RenjuNet 기보로 통계 만들기» — 세 걸음 목록과 두 단추)는 오프닝 화면에서 읽을 것들 뒤로
 * 물려 있어 지나치기 쉬웠다. 이제 탭 맨 위에 첫 실행 화면의 문법으로 선다: 원 안의 아이콘 · 굵은 제목 ·
 * 회색 한 문장 · 데이터가 주는 세 가지 · 할 일 하나. «나중에»면 한 줄 배너로 접힌다.
 *
 * 변환은 그대로 `RifImportLayer` 의 것(어느 화면에 놓아도 된다)이고, 이 카드는 그 진행 · 결과도 보인다.
 */

type Build = "idle" | "running" | "done" | "failed";

function useBuild(): Build {
  return useRifStore((s) => (s.job ? "running" : s.done ? "done" : s.error ? "failed" : "idle"));
}

/** RenjuNet 팩이 없는가 — 저장소를 읽기 전에는 null. */
function useMissing(): boolean | null {
  return useRifStore((s) => (s.ready ? s.pack === null : null));
}

/** 카드 · 배너 가운데 지금 것, 없으면 아무것도. 오프닝 · 랭킹 탭의 맨 위에 둔다. */
export function GameDataPromptSlot() {
  const missing = useMissing();
  const build = useBuild();
  const collapsed = useGameDataPrefs((s) => s.collapsed);
  const form = gameDataForm(missing, build, collapsed);
  if (form === "none") return null;
  if (form === "banner") return <GameDataBanner />;
  return <GameDataCard build={build} />;
}

function GameDataCard({ build }: { build: Build }) {
  return (
    <section className="panel gamedata" data-k="game-data" aria-labelledby="gamedata-title">
      <span className="gamedata__hero" aria-hidden="true">
        <Icon d={ICON.queryStats} />
      </span>
      <h2 id="gamedata-title" className="gamedata__title">
        {t("실전 대국 데이터를 추가하세요")}
      </h2>
      <p className="gamedata__lead">
        {t(
          "RenjuNet 의 실제 대국 기록으로 이 브라우저 안에서 만듭니다. 기록은 이 기기 밖으로 나가지 않습니다",
        )}
      </p>
      <ul className="gamedata__features">
        <Feature icon={ICON.explore} title={t("오프닝")} text={t("다음 수마다 실전 빈도와 승률")} />
        <Feature
          icon={ICON.leaderboard}
          title={t("랭킹")}
          text={t("26주형과 5수 모양의 실전 승률 · 빈도")}
        />
        <Feature
          icon={ICON.history}
          title={t("실제 기보")}
          text={t("이 국면을 지난 실제 대국을 보드에 올리기")}
        />
      </ul>
      <div className="gamedata__state">
        {build === "running" ? <Building /> : build === "done" ? <Done /> : <Waiting />}
      </div>
    </section>
  );
}

function Feature({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <li className="gamedata__feature">
      <span className="icontile" aria-hidden="true">
        <Icon d={icon} />
      </span>
      <span className="gamedata__ftext">
        <b>{title}</b>
        <span>{text}</span>
      </span>
    </li>
  );
}

/** 들어가는 길: 파일을 받는 법 한 줄, 채운 알약 하나, 조용한 나가는 길 둘. */
function Waiting() {
  const error = useRifStore((s) => s.error);
  const setCollapsed = useGameDataPrefs((s) => s.setCollapsed);
  return (
    <>
      {error && (
        <p className="gamedata__error" role="alert">
          {t("만들지 못했습니다: {why}", { why: error })}
        </p>
      )}
      <p className="gamedata__how">
        {t(
          "① renju.net 에서 «XML» 기보 파일(약 43MB)을 받고 ② 아래에서 고르거나 아무 화면에 끌어다 놓으면, 몇 초 만에 만듭니다",
        )}
      </p>
      <button type="button" className="cta gamedata__pick" onClick={pickRifFile}>
        {t("받은 파일 고르기")}
      </button>
      <div className="gamedata__quiet">
        <a className="ghostbtn" href={RENJUNET_DOWNLOADS} target="_blank" rel="noreferrer noopener">
          {t("renju.net 열기")}
        </a>
        <button
          type="button"
          className="ghostbtn gamedata__later"
          onClick={() => setCollapsed(true)}
        >
          {t("나중에")}
        </button>
      </div>
    </>
  );
}

/** 만드는 중: 단계 · 막대 · 다른 화면으로 가도 계속된다는 것. */
function Building() {
  const job = useRifStore((s) => s.job);
  const cancel = useRifStore((s) => s.cancel);
  if (!job) return null;
  const pct = Math.round(job.fraction * 100);
  return (
    <div className="gamedata__building" aria-live="polite" aria-busy="true">
      <p className="gamedata__phase tnum">
        {t(RIF_PHASE_TEXT[job.phase])} · {pct}%
      </p>
      <div
        className="lprogress__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={t("변환 진행")}
      >
        <SmoothFill fraction={job.fraction} />
      </div>
      <p className="gamedata__note">{t("다른 화면으로 가도 계속됩니다")}</p>
      <button type="button" className="ghostbtn" onClick={cancel}>
        {t("중지")}
      </button>
    </div>
  );
}

/** 끝: 연한 강조 알약에 체크 · 판 수, 그리고 확인. */
function Done() {
  const done = useRifStore((s) => s.done);
  const dismiss = useRifStore((s) => s.dismiss);
  if (!done) return null;
  return (
    <div className="gamedata__done" role="status">
      <p className="donecard">
        <span className="donecard__check" aria-hidden="true">
          <Icon d={ICON.check} />
        </span>
        <span className="tnum">
          {t("데이터가 준비됐습니다 · 대국 {n}판", { n: fmtInt(done.games) })}
        </span>
      </p>
      {done.saveError && <p className="gamedata__error">{done.saveError}</p>}
      <button type="button" className="ghostbtn" onClick={dismiss}>
        {t("확인")}
      </button>
    </div>
  );
}

/** 접은 카드: 무엇이 꺼져 있는지 한 줄, 그리고 되돌아가는 길. */
function GameDataBanner() {
  const setCollapsed = useGameDataPrefs((s) => s.setCollapsed);
  const local = useRifStore((s) => s.local !== null);
  return (
    <button
      type="button"
      className="gamedata-banner"
      data-k="game-data-banner"
      onClick={() => setCollapsed(false)}
    >
      <Icon d={ICON.queryStats} className="icon gamedata-banner__icon" />
      <span className="gamedata-banner__text">
        <b>{t("실전 대국 데이터가 없습니다")}</b>
        <span>
          {local ? t("지금은 내 기보로만 셉니다") : t("빈도 · 승률 · 실제 기보가 비어 있습니다")}
        </span>
      </span>
      <span className="gamedata-banner__add">{t("추가")}</span>
    </button>
  );
}

/**
 * 이 브라우저에서 한 번, 데이터 없이 오프닝이나 랭킹을 처음 열 때 — 같은 제안을 짧게 시트로. 어느 쪽으로
 * 나가도 본 것으로 친다.
 */
export function GameDataSheetOnce() {
  const missing = useMissing();
  const build = useBuild();
  const seen = useGameDataPrefs((s) => s.sheetSeen);
  const markSeen = useGameDataPrefs((s) => s.markSheetSeen);
  return (
    <Sheet
      open={gameDataSheetDue(missing, build, seen)}
      title={t("실전 대국 데이터를 추가할까요?")}
      onClose={markSeen}
      k="game-data-sheet"
      actions={
        <>
          <button type="button" className="ghostbtn" onClick={markSeen}>
            {t("나중에")}
          </button>
          <button
            type="button"
            className="cta"
            onClick={() => {
              markSeen();
              pickRifFile();
            }}
          >
            {t("받은 파일 고르기")}
          </button>
        </>
      }
    >
      <p className="sheet__text">
        {t(
          "오프닝의 실전 빈도 · 승률 · 실제 기보와 랭킹의 실전 표는 RenjuNet 대국 데이터로 채워집니다. renju.net 에서 «XML» 파일을 받아 고르면 몇 초 만에 만듭니다.",
        )}
      </p>
      <a
        className="ghostbtn sheet__link"
        href={RENJUNET_DOWNLOADS}
        target="_blank"
        rel="noreferrer noopener"
      >
        {t("renju.net 열기")}
      </a>
    </Sheet>
  );
}
