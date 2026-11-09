import { useId, useState } from "react";
import { useEngineStore, threadCap } from "../../engine/engine-state";
import {
  DEFAULT_REMOTE_HOST,
  DEFAULT_REMOTE_PORT,
  ENGINE_PREFERENCES,
  isNativePreference,
  isThreadedVariant,
  nativeBuildOf,
  nativeVariantOf,
  planOrder,
  preferenceBlocker,
  type Capabilities,
  type EnginePreference,
  type NativeBuilds,
} from "../../engine/engine-client";
import {
  AUTO_THREADS,
  THREAD_RELOAD_COST,
  autoThreads,
  deviceCores,
  planThreadChange,
  resolveThreads,
  useSettingsStore,
} from "./settingsStore";
import { Segmented } from "../../components/controls";
import { BUILD_LABEL, PREFERENCE_LABEL, VARIANT_LABEL } from "./engineLabels";
import { t } from "../../i18n/i18n";

/**
 * 엔진 조작부 — 설정 · 보드의 대국 탭이 함께 쓴다. 값은 모두 설정 스토어
 * 하나가 주인이라 어디서 바꾸든 같은 값이다.
 */

/**
 * 엔진 선택 드롭다운. 고르면 설정에 남고, 떠 있는 엔진은 **깨끗이 내렸다가 그 변형으로
 * 다시 띄운다**(`setEnginePreference` → `restart`). 이 환경에서 못 쓰는 항목은 꺼 두고
 * 까닭을 항목 이름에 붙인다 — 골라 놓고 조용히 다른 것이 뜨면 고장으로 읽힌다.
 *
 * 네이티브 `<select>` 다 — 펼친 목록은 운영체제의 것이라야 키보드·스크린 리더·휴대폰
 * 휠이 그대로 돈다. 겉모양만 토큰으로 칠한다(`.select`, `color-scheme`).
 */
/**
 * 이 환경에서 그 항목을 못 고르는 까닭. 데스크톱은 동봉 빌드마다 셸이 알려 준 대로 — 이 CPU 가 못 돌리거나
 * 파일이 없으면 꺼 둔다(못 도는 빌드를 띄우면 «잘못된 명령어»로 말없이 죽는다).
 */
function choiceBlocker(
  caps: Capabilities,
  builds: NativeBuilds | null,
  p: EnginePreference,
): string | null {
  const base = preferenceBlocker(caps, p);
  if (base) return base;
  const build = nativeBuildOf(p);
  const info = build ? builds?.builds.find((b) => b.id === build) : undefined;
  if (!info) return null;
  if (!info.supported) return t("이 CPU 가 지원하지 않는 명령어 집합입니다");
  if (!info.present) return t("설치 폴더에 이 빌드가 없습니다");
  return null;
}

/** 드롭다운 항목 — 웹은 WASM 넷, 데스크톱은 네이티브(자동 · 빌드 다섯) · 원격. */
const choicesFor = (caps: Capabilities): EnginePreference[] =>
  ENGINE_PREFERENCES.filter((p) => isNativePreference(p) === caps.native);

export function EngineSelect() {
  const id = useId();
  const caps = useEngineStore((s) => s.capabilities);
  const builds = useEngineStore((s) => s.nativeBuilds);
  const pref = useSettingsStore((s) => s.enginePreference);
  const update = useSettingsStore((s) => s.update);
  return (
    <span className="select">
      <label htmlFor={id} className="select__label">
        {t("엔진")}
      </label>
      <select
        id={id}
        className="select__input"
        aria-label={t("엔진 선택")}
        value={pref}
        disabled={!caps.variant && !caps.native}
        onChange={(e) => update({ enginePreference: e.target.value as EnginePreference })}
      >
        {/* 네이티브 · 원격은 데스크톱(Z3)에서만, WASM 은 웹에서만 — 서로 항목 자체를 보이지 않는다. */}
        {choicesFor(caps).map((p) => {
          const why = choiceBlocker(caps, builds, p);
          const auto = p === "native" && builds?.auto ? ` → ${BUILD_LABEL[builds.auto]}` : "";
          const name = t(PREFERENCE_LABEL[p]) + auto;
          return (
            <option key={p} value={p} disabled={why !== null && p !== pref} title={why ?? ""}>
              {why ? t("{name} (사용 불가)", { name }) : name}
            </option>
          );
        })}
      </select>
    </span>
  );
}

/** 설정 화면의 「엔진」 줄 — 드롭다운과, 지금 무엇이 왜 떠 있는지. */
export function EngineChoiceControl() {
  const caps = useEngineStore((s) => s.capabilities);
  const builds = useEngineStore((s) => s.nativeBuilds);
  const status = useEngineStore((s) => s.status);
  const engine = useEngineStore((s) => s.engine);
  const pref = useSettingsStore((s) => s.enginePreference);
  const path = useSettingsStore((s) => s.enginePath);
  const planned = planOrder(caps.variants, pref).order[0] ?? caps.variant;
  const blocker = choiceBlocker(caps, builds, pref);
  const shown = engine.variant ?? planned;
  const target = nativeVariantOf(pref);
  // 앱에 든 엔진이면 어느 빌드인지 — 고정한 것, 아니면 셸이 고를 것. 경로를 적었으면 그 파일이다.
  const build =
    shown === "native" && !path.trim() ? (nativeBuildOf(pref) ?? builds?.auto ?? null) : null;
  // 까닭(물러선 이유 · 못 쓰는 이유)은 툴팁으로 — 화면에는 무엇이 떴는지 한 줄만.
  const why =
    engine.fallbackReason ?? blocker ?? (pref === "auto" ? caps.threadsNote : null) ?? undefined;
  return (
    <div className="stack">
      <EngineSelect />
      {caps.native && target ? <NativeTargetField kind={target} /> : null}
      <p className="srow__hint tnum" data-k="engine-variant" title={why}>
        {shown ?? t("실행 불가")}
        {shown ? ` · ${VARIANT_LABEL[shown]}` : ""}
        {build ? ` · ${BUILD_LABEL[build]}` : ""}
        {engine.variant
          ? ` · ${t("실행 중")}`
          : status === "starting"
            ? ` · ${t("띄우는 중")}`
            : ""}
        {engine.fallbackReason ? ` · ${t("물러섬")}` : ""}
      </p>
    </div>
  );
}

/** 탐색기 «경로로 복사»가 붙이는 큰따옴표와 앞뒤 공백을 뗀다 — 셸(`engine.rs` `clean_path`)도 같은 일을 한다. */
const cleanEnginePath = (v: string) =>
  v
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .trim();

/** 열기 대화 상자로 엔진 실행 파일을 고른다 — 데스크톱 셸에서만(`tauri-plugin-dialog`, 열기만 허용). */
async function pickEngineFile(current: string): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    title: t("엔진 실행 파일"),
    multiple: false,
    directory: false,
    filters: [{ name: "Rapfi", extensions: ["exe"] }],
    ...(current ? { defaultPath: current } : {}),
  });
  return typeof picked === "string" ? picked : null;
}

/**
 * 네이티브 엔진의 자리(데스크톱 Z3) — 로컬 실행 파일 경로 또는 원격 `host:port`. 칸을 떠나거나 Enter 를 누를 때
 * 저장한다 — 글자마다 저장하면 떠 있는 네이티브 엔진이 글자마다 다시 뜬다. 로컬은 «찾아보기…»로 파일을 고르고
 * (붙여 넣은 경로의 따옴표는 뗀다), «기본값»으로 앱에 든 엔진으로 돌아간다.
 */
function NativeTargetField({ kind }: { kind: "native" | "remote" }) {
  const id = useId();
  const key = kind === "native" ? "enginePath" : "engineRemote";
  const saved = useSettingsStore((s) => s[key]);
  const update = useSettingsStore((s) => s.update);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const v = draft === null ? null : kind === "native" ? cleanEnginePath(draft) : draft.trim();
    if (v !== null && v !== saved) update({ [key]: v });
    setDraft(null);
  };
  const browse = () => {
    pickEngineFile(saved)
      .then((path) => {
        if (path && path !== saved) update({ [key]: path });
      })
      .catch(() => {
        // 대화 상자를 띄우지 못했으면(권한 · 플러그인 없음) 칸에 손으로 적는 길이 그대로 남는다.
      });
  };
  const label = kind === "native" ? t("엔진 실행 파일") : t("원격 서버 주소");
  return (
    <span className="field field--wide">
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      <span className="field__box">
        <input
          id={id}
          className="field__input field__input--text"
          value={draft ?? saved}
          spellCheck={false}
          autoComplete="off"
          placeholder={
            kind === "native"
              ? t("비우면 앱에 든 엔진(이 CPU에 맞는 변형)")
              : `${DEFAULT_REMOTE_HOST}:${DEFAULT_REMOTE_PORT}`
          }
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setDraft(null);
          }}
        />
        {kind === "native" && saved && (
          <button type="button" className="panel__link" onClick={() => update({ [key]: "" })}>
            {t("기본값")}
          </button>
        )}
        {kind === "native" && (
          <button type="button" className="panel__link" onClick={browse}>
            {t("찾아보기…")}
          </button>
        )}
      </span>
    </span>
  );
}

/**
 * 스레드 수 선택 — 자동 · 1 … 코어 수. 멀티 변형이 떠 있을 때만 엔진에 닿고, 탐색
 * 중에 바꾸면 **다음 탐색부터**다(엔진 스토어가 탐색 중에는 보내지 않는다).
 *
 * **떠 있는 멀티 엔진의 스레드 수는 곧바로 바꾸지 않는다**(P1-2). 바꿀 때마다 엔진이
 * 스레드를 다시 세우고 다음 탐색이 가중치를 다시 푼다(`THREAD_RELOAD_COST`). 1 → 2 → 3 을
 * 차례로 누르면 그 비용을 거듭 치렀다. 고른 값은 「대기」로 두고 비용을 알린 뒤 「적용」
 * 한 번에 보낸다. 엔진이 없을 때는 곧바로 저장한다 — 다음 기동의 기동 메시지로 예열 전에
 * 들어가므로(P1-1) 비용이 없다.
 */
export function ThreadControl() {
  const caps = useEngineStore((s) => s.capabilities);
  const status = useEngineStore((s) => s.status);
  const engine = useEngineStore((s) => s.engine);
  const applied = useEngineStore((s) => s.appliedThreads);
  const pref = useSettingsStore((s) => s.enginePreference);
  const v = useSettingsStore((s) => s.threads);
  const update = useSettingsStore((s) => s.update);
  /** 확정을 기다리는 선택(설정값 — 0 = 자동). */
  const [draft, setDraft] = useState<number | null>(null);

  const cores = deviceCores();
  const live = engine.threaded && (status === "ready" || status === "searching");
  const choose = (threads: number) => {
    const plan = planThreadChange({ next: threads, current: v, cores, applied, live });
    if (plan === "confirm") {
      setDraft(threads);
      return;
    }
    setDraft(null);
    if (plan === "apply") update({ threads });
  };
  const commit = () => {
    if (draft !== null) update({ threads: draft });
    setDraft(null);
  };
  const cap = threadCap(cores, engine.maxThreads);
  const single = engine.variant !== null && !isThreadedVariant(engine.variant);
  // 네이티브는 제 스레드로 돈다 — 원격은 서버의 엔진이라 여기서 정하지만 서버 CPU 만큼만 쓴다.
  const wantsMulti = pref === "auto" || pref === "multi" || isNativePreference(pref);
  const usable = caps.threads && wantsMulti && !single;
  const wanted = resolveThreads(v, cores);
  const options = [
    { value: AUTO_THREADS, label: t("자동 ({n})", { n: Math.min(cap, autoThreads(cores)) }) },
  ];
  for (let n = 1; n <= cap; n++) options.push({ value: n, label: String(n) });

  let line: string;
  if (!caps.threads) line = t("단일 스레드 환경");
  else if (!wantsMulti) line = t("단일 스레드 엔진");
  else if (single) line = t("단일 스레드로 실행 중");
  else if (status === "idle" || status === "error" || applied === null)
    line = t("기동 시 {n}", { n: wanted });
  else if (applied === wanted) line = t("적용 {n}", { n: applied });
  else line = t("다음 탐색부터 {n} (지금 {now})", { n: wanted, now: applied });

  return (
    <div className="stack">
      <Segmented
        label={t("스레드 수")}
        value={Math.min(draft ?? v, cap)}
        options={options}
        disabled={!usable}
        onChange={choose}
      />
      {draft !== null && (
        <div className="stack" data-k="threads-confirm">
          <p className="srow__hint tnum" role="status">
            {t("{n} 스레드: 다음 탐색이 {cost} 늦게 시작", {
              n: resolveThreads(draft, cores),
              cost: t(THREAD_RELOAD_COST),
            })}
          </p>
          <div className="actions">
            <button type="button" className="btn btn--tonal" onClick={commit}>
              {t("적용")}
            </button>
            <button type="button" className="btn" onClick={() => setDraft(null)}>
              {t("취소")}
            </button>
          </div>
        </div>
      )}
      <p className="srow__hint tnum" data-k="threads-status">
        {line}
        {cores ? ` · ${t("코어 {n}", { n: cores })}` : ""}
      </p>
    </div>
  );
}
