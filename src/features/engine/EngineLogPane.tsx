import { useEngineStore } from "../../engine/engine-state";
import { isNativeVariant } from "../../engine/engine-client";
import { useSettingsStore } from "../settings/settingsStore";
import { Disclosure } from "../../components/Disclosure";
import { localized, msg, t } from "../../i18n/i18n";
import { useProMode } from "../../app/proMode";
import { EngineConsole } from "./EngineConsole";

/**
 * 보드 «로그» 칸 — 엔진 상태 한 줄 · 기동/끄기 · 콘솔(라이브러리 계획 U2). 예전 엔진 탭이 하던 일을 그대로 옮겼다:
 * 엔진 탭은 «이상할 때 여는 창»이었는데, 그 이상함은 늘 판을 보다가 생긴다 — 판 옆 칸으로 오면 화면을 옮기지
 * 않고 엔진이 무엇을 받고 무엇을 말했는지 좇는다. 넓은 보드는 인스펙터의 칸, 휴대폰 세로는 시트의 칸이다.
 *
 * 상태는 한 줄(점 · 낱말 · 단추)로 줄이고 수치(변형 · 스레드 · 가중치 · 예열 …)는 접어 둔다 — 콘솔이 칸 높이를
 * 다 쓰게. 콘솔에 명령을 직접 넣는 입력줄은 고급 사용자 모드 뒤다(계획 §0 «위험한 쓰기만 모드 뒤»). 로그를
 * 읽고 거르고 저장하는 것은 모두에게.
 */

/** 가중치를 어디서 얻었나 — 캐시면 이번 기동에 20MB 를 받지 않았다. */
const WEIGHTS_SOURCE: Readonly<Record<"cache" | "network" | "glue", string>> = localized({
  cache: msg("캐시(해시 확인)"),
  network: msg("내려받음(해시 확인)"),
  glue: msg("글루가 받음"),
});

const STATUS_TEXT: Readonly<Record<string, string>> = localized({
  idle: msg("꺼짐"),
  starting: msg("기동 중"),
  ready: msg("대기"),
  searching: msg("탐색 중"),
  error: msg("오류"),
});

export function EngineLogPane() {
  const pro = useProMode();
  return (
    <div className="enginelog">
      <EngineStatus />
      <EngineConsole input={pro} />
    </div>
  );
}

function EngineStatus() {
  const status = useEngineStore((s) => s.status);
  const caps = useEngineStore((s) => s.capabilities);
  const error = useEngineStore((s) => s.error);
  const analyzing = useEngineStore((s) => s.analyzing);
  const start = useEngineStore((s) => s.start);
  const terminate = useEngineStore((s) => s.terminate);
  const send = useEngineStore((s) => s.send);
  const engine = useEngineStore((s) => s.engine);
  const applied = useEngineStore((s) => s.appliedThreads);
  const hashMb = useSettingsStore((s) => s.hashMb);
  const style = useSettingsStore((s) => s.style);

  const variant =
    engine.variant ?? (caps.variant ? t("{v} (뜨기 전)", { v: caps.variant }) : t("실행 불가"));

  return (
    <section
      className="panel enginelog__status"
      aria-busy={status === "starting"}
      data-k="engine-status"
    >
      <div className="enginelog__head">
        <span className="panel__badge" data-status={status} aria-hidden="true" />
        <span className="enginelog__title">{t("엔진")}</span>
        {/* 낭독은 상단 바의 엔진 표시(role=status)가 맡는다 — 같은 바뀜을 두 번 읽지 않게. */}
        <span className="panel__status">{STATUS_TEXT[status]}</span>
        <span className="enginelog__actions">
          {status === "idle" || status === "error" ? (
            <button type="button" onClick={() => void start()} disabled={!caps.variant}>
              {t("엔진 시작")}
            </button>
          ) : (
            <button type="button" onClick={terminate}>
              {t("종료")}
            </button>
          )}
          {/* 한 번 쓰는 동작이라 설정 목록이 아니라 엔진 곁에 둔다. 탐색 중에 보내면 읽던 표를 발밑에서
              비우게 되므로 대기 중일 때만. */}
          <button
            type="button"
            onClick={() => send({ kind: "raw", line: "YXHASHCLEAR" })}
            disabled={status !== "ready"}
            title={t("YXHASHCLEAR: 치환표를 지금 한 번 비웁니다")}
          >
            {t("해시 비우기")}
          </button>
        </span>
      </div>
      {!caps.variant && caps.note && <p className="panel__hint">{caps.note}</p>}
      {engine.fallbackReason && (
        <p className="panel__hint">{t("물러섬: {why}", { why: engine.fallbackReason })}</p>
      )}
      {!engine.variant && caps.threadsNote && caps.variant && (
        <p className="panel__hint">{caps.threadsNote}</p>
      )}
      {error && <p className="panel__error">{error}</p>}
      <Disclosure id="engine-detail" level={3} title={t("세부 수치")} summary={variant}>
        <dl className="kv">
          <dt>{t("변형")}</dt>
          <dd className="tnum" data-k="variant">
            {variant}
          </dd>
          <dt>{t("스레드")}</dt>
          <dd className="tnum" data-k="threads">
            {applied ?? t("없음")}
            {engine.variant ? ` · ${engine.threaded ? t("멀티스레드") : t("단일 스레드")}` : ""}
          </dd>
          <dt>{t("가중치")}</dt>
          <dd className="tnum" data-k="weights">
            {engine.variant && isNativeVariant(engine.variant)
              ? t("엔진이 직접 읽음")
              : engine.weightsSource === null
                ? t("없음")
                : `${WEIGHTS_SOURCE[engine.weightsSource]} · ${engine.weightsMs ?? 0}ms`}
          </dd>
          <dt>{t("예열")}</dt>
          <dd className="tnum" data-k="warmup">
            {engine.warmupMs === null ? t("없음") : `${engine.warmupMs}ms`}
          </dd>
          <dt>{t("해시")}</dt>
          <dd className="tnum">{hashMb} MB</dd>
          <dt>{t("스타일")}</dt>
          <dd className="tnum">{style}</dd>
          <dt>{t("분석")}</dt>
          <dd>{analyzing ? t("켜짐: 국면을 따라 읽는 중") : t("꺼짐")}</dd>
        </dl>
      </Disclosure>
    </section>
  );
}
