import { useMemo, useRef, useState, type ComponentType } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useGameStore, type BoardMode } from "../board/gameStore";
import { useBoardStore } from "../board/boardStore";
import { useThemeStore, type ThemeMode } from "../../app/theme";
import { PageTitle } from "../../app/PageTitle";
import { useProMode } from "../../app/proMode";
import { Icon } from "../../components/icons";
import { ICON } from "../../components/icon-paths";
import { MiniBoard } from "../../components/MiniBoard";
import {
  HASH_CHOICES_MB,
  MAX_DEPTH_LIMIT,
  MAX_NODE_CHOICES,
  MIN_DEPTH,
  STYLE_RANGE,
  useSettingsStore,
  type VcThread,
} from "./settingsStore";
import { NumberField, Segmented, Switch } from "../../components/controls";
import { EngineChoiceControl, ThreadControl } from "./engineControls";
import { exportDesktopFiles, importDesktopFiles } from "./desktopBridge";
import { useSettingsFile } from "./settingsFileSync";
import { AboutPanel } from "./AboutPanel";
import { IS_DESKTOP } from "../../app/desktop/platform";
import { UserCommandsEditor } from "../../app/commands/UserCommandsEditor";
import { useAdminTools } from "../joseki/admin";
import { MAPPED_IDS } from "../../core/settings/desktop-bridge";
import { ALL_SPECS } from "../../core/settings/desktop-settings";
import { msg, pick, setLang, t, useLang, type Lang } from "../../i18n/i18n";
import { useStagger } from "../../components/useStagger";

/**
 * 설정 — 앱 UI 개편 2차 M3: **목록 → 하위 화면**.
 *
 * 첫 화면은 큰 제목 · 알약 검색 · 아이콘 + 제목 + 부제 + 꺾쇠 줄이다: 디자인 · 일반 · 엔진 / 고급 사용자 모드(스위치)
 * · PC 설정(고급 모드만) / 정보. 줄을 누르면 하위 화면(`/settings/<page>` — 브라우저 «뒤로»가 첫 화면으로)이 원형
 * 뒤로 단추 + 큰 제목 + 섹션 머리 + 연결 그룹으로 열린다.
 *
 * **대국과 분석의 설정은 보드의 두 탭에 있다.** 컴퓨터 색 · 착수 시간 · 레벨 · 개시는 [대국] 탭, 분석 시간 · 후보 수
 * · 정지하면 최선수 두기는 [분석] 탭 — 대국을 시작하거나 분석을 돌리는 바로 그 자리다. 같은 조작부를 여기에도 두면
 * 어느 쪽이 참인지 되묻게 된다. 검색은 그 이름들을 길잡이 줄로 찾아 준다.
 *
 * 엔진 탐색 파라미터(해시 · 스타일 · 깊이 · 노드 · 위협 확인)와 PC 설정은 **고급 사용자 모드**에서만 보인다(`pro`).
 * 검색은 층을 가리지 않는다 — 이름이나 INFO 키를 아는 사람이 스위치부터 찾게 하지 않는다. 찾은 줄은 그 자리에서
 * 바로 바꿀 수 있다(어느 하위 화면의 것인지 그룹 머리가 말한다).
 *
 * 줄마다 그 값이 엔진의 어느 `INFO` 키를 움직이는지 적는다(앱의 `engineKey`).
 */

type Page = "design" | "general" | "engine" | "desktop" | "about";

/** 하위 화면의 이름 — 사전 열쇠(한국어 원문), 그릴 때 `t()`. */
const PAGE_TITLE: Record<Page, string> = {
  design: msg("디자인"),
  general: msg("일반"),
  engine: msg("엔진"),
  desktop: msg("PC 설정"),
  about: msg("정보"),
};
const PAGES = Object.keys(PAGE_TITLE) as Page[];

interface RowSpec {
  id: string;
  /** 어느 하위 화면의 줄인가. */
  page: Exclude<Page, "about">;
  /** 그 화면 안의 연결 그룹 머리(사전 열쇠). */
  group: string;
  /** 고급 사용자 모드에서만(검색은 가리지 않는다). */
  pro?: boolean;
  /** 이름 없이 조작부만 — 그룹 머리가 이미 그 이름이다(테마 단추 · 언어 줄). */
  bare?: boolean;
  label: string;
  note?: string;
  /** 이 값이 움직이는 엔진 명령(`INFO <key>` 등). 검색 대상이다. */
  engineKey?: string;
  /** 검색에만 쓰는 낱말. */
  keywords?: string;
  /** 조작부가 제 줄 아래로 넓게 내려간다(칩이 여럿일 때). */
  wide?: boolean;
  Control: ComponentType;
}

// ── 조작부 ─────────────────────────────────────────────────────────

function AutoBootControl() {
  const on = useSettingsStore((s) => s.autoBoot);
  const update = useSettingsStore((s) => s.update);
  return (
    <Switch
      label={t("앱을 열면 엔진 시작")}
      on={on}
      onChange={(autoBoot) => update({ autoBoot })}
    />
  );
}

/** 관리자 도구 — 커리큘럼 스튜디오와 정석 편집기의 «레슨으로» 단추를 연다(보안 장치 아님, `joseki/admin.ts`). */
function AdminToolsControl() {
  const on = useAdminTools((a) => a.on);
  const set = useAdminTools((a) => a.set);
  return <Switch label={t("관리자 도구")} on={on} onChange={set} />;
}

/** 대국·분석 설정이 옮겨 간 자리로 — 누르면 그 탭을 연 보드로 간다. */
function BoardTabsControl() {
  const navigate = useNavigate();
  const setMode = useGameStore((s) => s.setMode);
  const open = (m: BoardMode) => {
    setMode(m);
    navigate("/board");
  };
  return (
    <div className="actions">
      <button type="button" className="btn" onClick={() => open("analysis")}>
        {t("보드 › 분석 탭")}
      </button>
      <button type="button" className="btn" onClick={() => open("game")}>
        {t("보드 › 대국 탭")}
      </button>
    </div>
  );
}

function HashControl() {
  const v = useSettingsStore((s) => s.hashMb);
  const update = useSettingsStore((s) => s.update);
  return (
    <Segmented
      label={t("해시 크기")}
      value={v}
      options={HASH_CHOICES_MB.map((mb) => ({ value: mb, label: `${mb}` }))}
      onChange={(hashMb) => update({ hashMb })}
    />
  );
}

function StyleControl() {
  const v = useSettingsStore((s) => s.style);
  const update = useSettingsStore((s) => s.update);
  const options: { value: number; label: string }[] = [];
  for (let i = STYLE_RANGE.min; i <= STYLE_RANGE.max; i++) {
    const label =
      i === STYLE_RANGE.min
        ? `${i} ${t("성급")}`
        : i === STYLE_RANGE.max
          ? `${i} ${t("신중")}`
          : `${i}`;
    options.push({ value: i, label });
  }
  return (
    <Segmented
      label={t("스타일")}
      value={v}
      options={options}
      onChange={(style) => update({ style })}
    />
  );
}

function MaxDepthControl() {
  const v = useSettingsStore((s) => s.maxDepth);
  const update = useSettingsStore((s) => s.update);
  return (
    <NumberField
      label={t("최대 깊이")}
      hideLabel
      unit={t("플라이")}
      min={MIN_DEPTH}
      max={MAX_DEPTH_LIMIT}
      value={v}
      onCommit={(maxDepth) => update({ maxDepth })}
    />
  );
}

const nodeLabel = (n: number) =>
  n < 0
    ? t("무제한")
    : pick(
        n >= 100_000_000 ? `${n / 100_000_000}억` : `${n / 10_000}만`,
        n >= 1e9 ? `${n / 1e9}B` : n >= 1e6 ? `${n / 1e6}M` : `${n / 1e3}K`,
      );

function MaxNodeControl() {
  const v = useSettingsStore((s) => s.maxNode);
  const update = useSettingsStore((s) => s.update);
  return (
    <Segmented
      label={t("최대 노드")}
      value={v}
      options={MAX_NODE_CHOICES.map((n) => ({ value: n, label: nodeLabel(n) }))}
      onChange={(maxNode) => update({ maxNode })}
    />
  );
}

function VcThreadControl() {
  const v = useSettingsStore((s) => s.vcThread);
  const update = useSettingsStore((s) => s.update);
  const options: { value: VcThread; label: string }[] = [
    { value: 0, label: t("없음") },
    { value: 1, label: t("VCT 확인") },
    { value: 2, label: t("VC2 확인") },
  ];
  return (
    <Segmented
      label={t("추가 위협 확인")}
      value={v}
      options={options}
      onChange={(vcThread) => update({ vcThread })}
    />
  );
}

function HashAutoClearControl() {
  const on = useSettingsStore((s) => s.hashAutoClear);
  const update = useSettingsStore((s) => s.update);
  return (
    <Switch label={t("해시 자동 지우기")} on={on} onChange={(v) => update({ hashAutoClear: v })} />
  );
}

function EvalBarControl() {
  const on = useSettingsStore((s) => s.showEvalBar);
  const update = useSettingsStore((s) => s.update);
  return <Switch label={t("평가 바 표시")} on={on} onChange={(v) => update({ showEvalBar: v })} />;
}

function NumbersControl() {
  const on = useBoardStore((s) => s.render.showNumbers);
  const toggle = useBoardStore((s) => s.toggleNumbers);
  return <Switch label={t("번호 매기기")} on={on} onChange={toggle} />;
}

function ForbiddenControl() {
  const on = useGameStore((s) => s.showForbidden);
  const toggle = useGameStore((s) => s.toggleForbidden);
  return <Switch label={t("금수 표시")} on={on} onChange={toggle} />;
}

const THEMES: readonly { value: ThemeMode; label: string }[] = [
  { value: "system", label: msg("시스템") },
  { value: "light", label: msg("밝게") },
  { value: "dark", label: msg("어둡게") },
];

const THEME_ICON: Record<ThemeMode, string> = {
  system: ICON.themeAuto,
  light: ICON.themeLightMode,
  dark: ICON.themeDarkMode,
};

/**
 * 테마 — 아이콘 단추 셋(앱 M3 «디자인»): 시스템 · 밝게 · 어둡게. 고른 것은 진한 강조색으로 채워지고 모서리가
 * 둥글어진다(모핑). 라디오 묶음이라 화면 낭독기는 «선택됨 · 라디오»로 읽는다.
 */
function ThemeControl() {
  const mode = useThemeStore((s) => s.mode);
  const set = useThemeStore((s) => s.set);
  return (
    <div className="themechoice" role="radiogroup" aria-label={t("테마")}>
      {THEMES.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={mode === o.value}
          className="themechoice__opt"
          onClick={() => set(o.value)}
        >
          <Icon d={THEME_ICON[o.value]} />
          <span>{t(o.label)}</span>
        </button>
      ))}
    </div>
  );
}

function AmoledControl() {
  const on = useThemeStore((s) => s.amoled);
  const set = useThemeStore((s) => s.setAmoled);
  return <Switch label={t("검은 배경")} on={on} onChange={set} />;
}

/** 언어(W10) — 항목 이름은 그 언어 자신의 이름으로(읽지 못하는 화면에서도 찾게). */
const LANGS: readonly { value: Lang; label: string; lang: string }[] = [
  { value: "ko", label: "한국어", lang: "ko" },
  { value: "en", label: "English", lang: "en" },
];

/**
 * 언어 — 항목마다 한 줄, 고른 줄 끝에 채운 체크 원(앱 M3). 항목이 적은 고르기는 칩이 아니라 줄이다.
 */
function LangControl() {
  const lang = useLang((s) => s.lang);
  return (
    <div className="radiorows" role="radiogroup" aria-label={t("언어")}>
      {LANGS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={lang === o.value}
          lang={o.lang}
          className="radiorow"
          onClick={() => setLang(o.value)}
        >
          <span className="radiorow__label">{o.label}</span>
          <span className="checkcircle" aria-hidden="true">
            <Icon d={ICON.check} />
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * 데스크톱 settings.txt · settings_dev.txt 가져오기 · 내보내기(W5b). 67칸 중 웹이 뜻을 가진 칸만
 * 웹 값이 되고, 나머지는 들고 있다가 내보낼 때 돌려준다(`desktopBridge.ts`).
 */
function DesktopFileControl() {
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<string | null>(null);
  return (
    <div className="desktopfile">
      <SettingsFileSync />
      <div className="actions">
        <button type="button" className="btn" onClick={() => input.current?.click()}>
          {t("가져오기")}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            exportDesktopFiles();
            setResult(t("settings.txt · settings_dev.txt 를 내려받았습니다"));
          }}
        >
          {t("내보내기")}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept=".txt,text/plain"
        multiple
        hidden
        data-k="desktop-settings-input"
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = "";
          if (!files.length) return;
          void importDesktopFiles(files).then((r) => {
            const got = r.files.map((f) => `${f.name}${f.file ? "" : t("(모름)")}`).join(", ");
            setResult([t("가져옴: {files}", { files: got }), ...r.notes].join("\n"));
          });
        }}
      />
      {result && (
        <p className="desktopfile__result" role="status" data-k="desktop-settings-result">
          {result}
        </p>
      )}
    </div>
  );
}

/**
 * 데스크톱 Z4 — 폴더의 settings.txt · settings_dev.txt 를 직접 읽고 쓴다(`settingsFileSync.ts`).
 * 데스크톱 셸 안에서만 보인다. 가져오기 · 내보내기는 그대로 남는다(다른 폴더의 파일을 한 번 옮길 때).
 */
function SettingsFileSync() {
  const f = useSettingsFile();
  const [draft, setDraft] = useState<string | null>(null);
  if (!f.available) return null;
  const commit = () => {
    if (draft !== null) void f.setDir(draft);
    setDraft(null);
  };
  return (
    <div className="desktopfile__sync" data-k="settings-file-sync">
      <div className="review__row">
        <span className="review__label">{t("폴더의 파일과 직접 맞추기")}</span>
        <Switch
          label={t("폴더의 파일과 직접 맞추기")}
          on={f.enabled}
          onChange={(on) => void f.setEnabled(on)}
        />
      </div>
      {f.enabled && (
        <>
          <span className="field field--wide">
            <label htmlFor="settings-file-dir" className="field__label">
              {t("설정 파일 폴더")}
            </label>
            <span className="field__box">
              <input
                id="settings-file-dir"
                className="field__input field__input--text"
                value={draft ?? f.dir}
                spellCheck={false}
                autoComplete="off"
                placeholder={t("비우면 앱 폴더")}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") setDraft(null);
                }}
              />
            </span>
          </span>
          <p className="panel__hint tnum">
            {f.resolvedDir ?? "…"}
            {f.status ? ` · ${f.status}` : ""}
          </p>
          {f.error && (
            <p className="desktopfile__result" role="alert">
              {f.error}
            </p>
          )}
          <div className="actions">
            <button type="button" className="btn" onClick={() => void f.reload()}>
              {t("파일에서 다시 읽기")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ResetControl() {
  const reset = useSettingsStore((s) => s.reset);
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className="btn" onClick={() => setAsking(true)}>
        {t("기본값으로 되돌리기")}
      </button>
    );
  }
  // 되돌릴 수 없는 동작이라 한 번 더 묻는다(데스크톱의 「실행 취소 경고」).
  return (
    <div className="actions">
      <button
        type="button"
        className="btn btn--danger"
        onClick={() => {
          reset();
          setAsking(false);
        }}
      >
        {t("되돌리기")}
      </button>
      <button type="button" className="btn" autoFocus onClick={() => setAsking(false)}>
        {t("취소")}
      </button>
    </div>
  );
}

// ── 목록 ───────────────────────────────────────────────────────────

const ROWS: readonly RowSpec[] = [
  // 자주 쓰는 설정 — 엔진과 화면.
  {
    id: "engine",
    page: "engine",
    group: msg("탐색"),
    label: msg("엔진"),
    note: msg("바꾸면 엔진을 다시 띄웁니다(분석은 이어 읽음)"),
    keywords:
      "wasm simd relaxed standard multi single thread pthread 멀티 단일 변형 바이너리 멀티스레드 사용",
    wide: true,
    Control: EngineChoiceControl,
  },
  {
    id: "threads",
    page: "engine",
    group: msg("탐색"),
    label: msg("스레드 수"),
    note: msg("자동 = 코어 − 1 (최대 4)"),
    engineKey: "thread_num",
    keywords: "threads 코어 cpu",
    wide: true,
    Control: ThreadControl,
  },
  {
    id: "autoBoot",
    page: "general",
    group: msg("동작"),
    label: msg("앱을 열면 엔진 시작"),
    note: msg("가중치 20MB 는 처음 한 번만 받습니다"),
    keywords: "자동 기동 부팅 autoboot 시작",
    Control: AutoBootControl,
  },
  {
    id: "boardTabs",
    page: "general",
    group: msg("보드"),
    label: msg("대국 · 분석 설정"),
    note: msg("컴퓨터 색 · 착수 시간 · 레벨 · 개시 · 분석 시간 · 후보 수"),
    keywords:
      "컴퓨터 흑 백 사람 진영 착수 시간 레벨 level timeout_turn 룰셋 규칙 렌주 개시 오프닝 RIF 교환 swap 분석 시간 후보 nbest pv 멀티 PV 정지 최선수",
    wide: true,
    Control: BoardTabsControl,
  },
  {
    id: "theme",
    page: "design",
    group: msg("테마"),
    bare: true,
    label: msg("테마"),

    keywords: "테마 dark theme light",
    wide: true,
    Control: ThemeControl,
  },
  {
    id: "amoled",
    page: "design",
    group: msg("바탕"),
    label: msg("검은 배경"),
    note: msg("어두운 테마에서 바탕을 검정으로"),
    keywords: "amoled oled 블랙 검정 black 다크 dark",
    Control: AmoledControl,
  },
  {
    id: "lang",
    page: "general",
    group: msg("언어"),
    bare: true,
    label: msg("언어"),
    keywords: "language lang english korean 한국어 영어",
    wide: true,
    Control: LangControl,
  },

  // 고급 — 엔진
  {
    id: "hash",
    page: "engine",
    group: msg("엔진 파라미터"),
    pro: true,
    label: msg("해시 크기 (MB)"),
    note: msg("탭 메모리 한도 안에서"),
    engineKey: "hash_size",
    keywords: "메모리 tt",
    wide: true,
    Control: HashControl,
  },
  {
    id: "hashAutoClear",
    page: "engine",
    group: msg("엔진 파라미터"),
    pro: true,
    label: msg("해시 자동 지우기"),
    note: msg("탐색마다 해시를 비웁니다"),
    engineKey: "YXHASHCLEAR",
    Control: HashAutoClearControl,
  },
  {
    id: "style",
    page: "engine",
    group: msg("엔진 파라미터"),
    pro: true,
    label: msg("스타일"),

    engineKey: "caution_factor",
    wide: true,
    Control: StyleControl,
  },
  {
    id: "maxDepth",
    page: "engine",
    group: msg("엔진 파라미터"),
    pro: true,
    label: msg("최대 깊이"),
    note: msg("{n} = 무제한"),
    engineKey: "max_depth",
    Control: MaxDepthControl,
  },
  {
    id: "maxNode",
    page: "engine",
    group: msg("엔진 파라미터"),
    pro: true,
    label: msg("최대 노드 수"),

    engineKey: "max_node",
    wide: true,
    Control: MaxNodeControl,
  },
  {
    id: "vcthread",
    page: "engine",
    group: msg("엔진 파라미터"),
    pro: true,
    label: msg("전역 검색 추가 위협 확인"),
    engineKey: "vcthread",
    keywords: "vct vc2",
    wide: true,
    Control: VcThreadControl,
  },

  // 고급 — 표시
  {
    id: "evalBar",
    page: "design",
    group: msg("판"),
    label: msg("평가 바 표시"),

    keywords: "eval bar 승률 게이지",
    Control: EvalBarControl,
  },
  {
    id: "numbers",
    page: "design",
    group: msg("판"),
    label: msg("번호 매기기"),

    Control: NumbersControl,
  },
  {
    id: "forbidden",
    page: "design",
    group: msg("판"),
    label: msg("금수 표시"),

    engineKey: "YXSHOWFORBID",
    Control: ForbiddenControl,
  },

  // 고급 — 시스템
  {
    id: "desktopFile",
    page: "desktop",
    group: msg("설정 파일"),
    pro: true,
    label: msg("데스크톱 설정 파일"),
    note: msg(
      "settings.txt · settings_dev.txt ({all}칸 중 {mapped}칸이 웹에 반영, 나머지는 그대로 보관)",
    ),
    keywords: "settings.txt settings_dev.txt pc 데스크톱 가져오기 내보내기 import export yixin",
    wide: true,
    Control: DesktopFileControl,
  },
  // 데스크톱 앱에서만 — 명령 팔레트 · 단축키가 데스크톱에만 있다(Z4).
  ...(IS_DESKTOP
    ? [
        {
          id: "userCommands",
          page: "desktop",
          group: msg("사용자 명령"),
          label: msg("사용자 명령"),
          note: msg(
            "Yixin 사용자 툴바 · 단축키 자리. 명령 팔레트(Ctrl+K)와 묶은 단축키로 부릅니다. Yixin function 폴더의 txt 를 가져올 수 있습니다",
          ),
          keywords:
            "user command 사용자 명령 툴바 toolbar hotkey 단축키 팔레트 palette yixin function 매크로 macro",
          wide: true,
          Control: UserCommandsEditor,
        } satisfies RowSpec,
      ]
    : []),
  {
    id: "adminTools",
    page: "desktop",
    group: msg("관리자"),
    pro: true,
    label: msg("관리자 도구"),
    note: msg(
      "정석 ▸ 공식 커리큘럼에 «커리큘럼 편집»(스튜디오)을 엽니다. 배포는 저장소 커밋으로만 됩니다",
    ),
    keywords: "admin 관리자 커리큘럼 curriculum 공식 정석 내보내기 스튜디오 studio 레슨 lesson",
    Control: AdminToolsControl,
  },
  {
    id: "reset",
    page: "desktop",
    group: msg("초기화"),
    pro: true,
    label: msg("설정 초기화"),
    note: msg("대국은 그대로입니다"),
    keywords: "기본값 reset",
    Control: ResetControl,
  },
];

/** 설명의 자리 값(`{n}` 등) — 줄마다 같다. */
const NOTE_VARS = { n: MAX_DEPTH_LIMIT, all: ALL_SPECS.length, mapped: MAPPED_IDS.length };
const noteOf = (r: RowSpec) => (r.note ? t(r.note, NOTE_VARS) : undefined);

/** 검색은 두 언어를 다 본다 — 영어 화면에서 한국어 낱말로 찾아도 걸린다. */
const matches = (r: RowSpec, q: string) =>
  !q ||
  [
    r.label,
    t(r.label),
    r.note,
    noteOf(r),
    r.engineKey,
    r.keywords,
    PAGE_TITLE[r.page],
    t(PAGE_TITLE[r.page]),
    r.group,
    t(r.group),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(q);

/** 줄들을 그룹 머리로 묶는다(처음 나온 순서). */
function grouped(rows: readonly RowSpec[], by: (r: RowSpec) => string) {
  const out = new Map<string, RowSpec[]>();
  for (const r of rows) out.set(by(r), [...(out.get(by(r)) ?? []), r]);
  return [...out];
}

/**
 * 연결 그룹 — 앱 `ConnectedGroup`(M3 · P4): 머리는 그룹 **위**에 강조색으로, 줄마다 제 면, 바깥 모서리만 카드
 * 반경이고 줄 사이는 작은 틈. 구분선 대신 틈이 줄을 가른다.
 */
function Group({ id, title, children }: { id: string; title?: string; children: React.ReactNode }) {
  return (
    <section className="sgroup" data-sec={id} aria-labelledby={title ? `sg-${id}` : undefined}>
      {title && (
        <h2 id={`sg-${id}`} className="sgroup__title">
          {title}
        </h2>
      )}
      <div className="sgroup__rows">{children}</div>
    </section>
  );
}

function Row({ r, keyTag }: { r: RowSpec; keyTag: boolean }) {
  if (r.bare)
    return (
      <div className="srow srow--bare" data-row={r.id}>
        <r.Control />
      </div>
    );
  return (
    <div className="srow" data-row={r.id} data-wide={r.wide || undefined}>
      {/* 설명은 펼쳐 적지 않고 툴팁으로 — 화면에는 이름만. 검색은 여전히 설명까지 찾는다.
          INFO 키 꼬리표는 엔진 파라미터에서만(그것을 만지는 사람의 것이다). */}
      <div className="srow__text" title={noteOf(r)}>
        <span className="srow__label">{t(r.label)}</span>
        {r.engineKey && keyTag && <code className="srow__key">{r.engineKey}</code>}
      </div>
      <div className="srow__control">
        <r.Control />
      </div>
    </div>
  );
}

/** 첫 화면의 한 줄 — 앱 `LinkRow`: 외곽선 아이콘 · 제목 · 부제 · 꺾쇠, 줄 전체가 한 터치 대상. */
function LinkRow({
  to,
  icon,
  title,
  note,
}: {
  to: Page;
  icon: string;
  title: string;
  note: string;
}) {
  return (
    <Link to={to} className="srow slink" data-row={`page-${to}`}>
      <span className="slink__icon" aria-hidden="true">
        <Icon d={icon} />
      </span>
      <span className="slink__text">
        <span className="srow__label">{title}</span>
        <span className="srow__note">{note}</span>
      </span>
      <Icon d={ICON.chevron} />
    </Link>
  );
}

const PAGE_ICON: Record<Page, string> = {
  design: ICON.palette,
  general: ICON.tune,
  engine: ICON.memory,
  desktop: ICON.computer,
  about: ICON.info,
};

/** 첫 화면 — 큰 제목 · 알약 검색 · 하위 화면 줄. 검색 중이면 찾은 줄을 하위 화면별로 그 자리에서. */
function RootPage() {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const pro = useProMode();
  const update = useSettingsStore((s) => s.update);
  const found = useMemo(() => (q ? ROWS.filter((r) => matches(r, q)) : []), [q]);
  const stagger = useStagger("settings-root");

  return (
    <>
      <PageTitle>{t("설정")}</PageTitle>
      <div className="settings__head">
        <div className="search">
          <svg className="icon search__icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
          </svg>
          <input
            className="search__input"
            type="search"
            placeholder={t("설정 검색")}
            aria-label={t("설정 검색")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {/* 찾는 중에만 몇 줄이 걸렸는지. */}
        {q && (
          <p className="settings__meta tnum">
            {found.length}/{ROWS.length}
          </p>
        )}
      </div>

      {q ? (
        found.length === 0 ? (
          <p className="settings__empty">{t("「{q}」에 맞는 설정이 없습니다.", { q: query })}</p>
        ) : (
          grouped(found, (r) => r.page).map(([page, rows]) => (
            <Group key={page} id={`found-${page}`} title={t(PAGE_TITLE[page as Page])}>
              {rows.map((r) => (
                <Row key={r.id} r={r} keyTag />
              ))}
            </Group>
          ))
        )
      ) : (
        <div className={"settings__groups" + stagger}>
          <Group id="pages">
            <LinkRow
              to="design"
              icon={PAGE_ICON.design}
              title={t("디자인")}
              note={t("테마 · 검은 배경 · 판 표시")}
            />
            <LinkRow
              to="general"
              icon={PAGE_ICON.general}
              title={t("일반")}
              note={t("언어 · 엔진 자동 시작")}
            />
            <LinkRow
              to="engine"
              icon={PAGE_ICON.engine}
              title={t("엔진")}
              note={pro ? t("엔진 · 스레드 · 해시 · 스타일 · 깊이 · 노드") : t("엔진 · 스레드 수")}
            />
          </Group>
          <Group id="pro">
            <div className="srow slink slink--switch" data-row="pro">
              <span className="slink__icon" aria-hidden="true">
                <Icon d={ICON.tune} />
              </span>
              <span className="slink__text">
                <span className="srow__label">{t("고급 사용자 모드")}</span>
                <span className="srow__note">
                  {t("DB 탭 · 엔진 콘솔 · 엔진 파라미터 · PC 설정")}
                </span>
              </span>
              <Switch
                label={t("고급 사용자 모드")}
                on={pro}
                onChange={(v) => update({ showAdvanced: v })}
              />
            </div>
            {pro && (
              <LinkRow
                to="desktop"
                icon={PAGE_ICON.desktop}
                title={t("PC 설정")}
                note={t("데스크톱 설정 파일 · 관리자 도구 · 초기화")}
              />
            )}
          </Group>
          <Group id="about-link">
            <LinkRow
              to="about"
              icon={PAGE_ICON.about}
              title={t("정보")}
              note={t("Zenyth Web · 라이선스")}
            />
          </Group>
        </div>
      )}
    </>
  );
}

/**
 * 디자인 화면의 미리보기 카드(앱 M3): 흐린 강조색 원이 깔린 면 위에 작은 판과 미니 툴바, 오른쪽 아래 «밝은 /
 * 어두운» 배지. 고른 테마 · 검은 배경이 여기서 먼저 보인다.
 */
function DesignPreview() {
  return (
    <div className="designpreview" aria-hidden="true">
      <MiniBoard
        className="designpreview__board"
        moves={[
          { x: 7, y: 7 },
          { x: 8, y: 8 },
          { x: 8, y: 6 },
          { x: 6, y: 8 },
          { x: 9, y: 5 },
        ]}
      />
      <span className="designpreview__keys">
        <span className="designpreview__key" />
        <span className="designpreview__key designpreview__key--play" />
        <span className="designpreview__key" />
      </span>
      <span className="designpreview__badge">
        <span className="designpreview__light">{t("밝은")}</span>
        <span className="designpreview__dark">{t("어두운")}</span>
      </span>
    </div>
  );
}

/** 하위 화면 — 원형 뒤로 · 큰 제목 · 섹션 머리 · 연결 그룹. */
function SubPage({ page }: { page: Page }) {
  const pro = useProMode();
  const rows = ROWS.filter((r) => r.page === page && (!r.pro || pro));
  return (
    <>
      <Link
        to="/settings"
        className="iconbtn iconbtn--back settings__back"
        aria-label={t("설정으로")}
      >
        <Icon d={ICON.back} />
      </Link>
      <PageTitle>{t(PAGE_TITLE[page])}</PageTitle>
      {page === "design" && <DesignPreview />}
      {page === "about" ? (
        <AboutPanel />
      ) : (
        grouped(rows, (r) => r.group).map(([group, list]) => (
          <Group key={group} id={`${page}-${list[0]!.id}`} title={t(group)}>
            {list.map((r) => (
              <Row key={r.id} r={r} keyTag={page === "engine"} />
            ))}
          </Group>
        ))
      )}
    </>
  );
}

export function SettingsScreen() {
  const { page } = useParams();
  if (page && !PAGES.includes(page as Page)) return <Navigate to="/settings" replace />;
  return (
    <div className="settings" data-page={page ?? "root"}>
      {page ? <SubPage page={page as Page} /> : <RootPage />}
    </div>
  );
}
