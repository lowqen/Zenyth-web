import { useEffect, useRef, useState } from "react";
import type { Window as TauriWindow } from "@tauri-apps/api/window";
import { useGameStore } from "../../features/board/gameStore";
import { t } from "../../i18n/i18n";

/**
 * 커스텀 타이틀바(데스크톱 Z2) — 운영체제 장식을 끄고(tauri.conf.json `decorations: false`) 앱이 그린다.
 * 높이 · 캡션 버튼 폭은 Z1 토큰(`--titlebar-height` 40 · `--caption-button-width` 46, Windows 11 과 같은 값).
 *
 * - 빈 곳을 끌면 창이 옮겨지고 두 번 누르면 최대화(`data-tauri-drag-region` — 그 요소 자신에만 걸리므로
 *   글자 · 아이콘에도 붙인다). 버튼에는 붙이지 않는다.
 * - Windows 11 이면 반투명 크롬 뒤로 Mica 가 비친다(`:root[data-mica]`). 판은 언제나 불투명이다.
 * - 가운데에는 열린 기보 이름 — 화면 이름은 바로 아래 상단 바가 이미 말한다.
 *
 * `@tauri-apps/api` 는 동적으로 받는다 — 이 컴포넌트는 데스크톱에서만 그려지지만 웹 번들의 AppShell 에 들어 있다.
 */
export function TitleBar() {
  const gameName = useGameStore((s) => s.gameName);
  const [maximized, setMaximized] = useState(false);
  const win = useRef<TauriWindow | null>(null);

  useEffect(() => {
    let alive = true;
    let off: (() => void) | undefined;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const w = getCurrentWindow();
      win.current = w;
      const update = async () => {
        const m = await w.isMaximized();
        if (alive) setMaximized(m);
      };
      await update();
      const unlisten = await w.onResized(() => void update());
      if (alive) off = unlisten;
      else unlisten();
    });
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  return (
    <header className="titlebar" data-tauri-drag-region>
      <img
        className="titlebar__icon"
        src={`${import.meta.env.BASE_URL}favicon.svg`}
        alt=""
        draggable={false}
        data-tauri-drag-region
      />
      <span className="titlebar__app" data-tauri-drag-region>
        Zenyth
      </span>
      {gameName && (
        <span className="titlebar__doc" data-tauri-drag-region>
          {gameName}
        </span>
      )}
      <div className="titlebar__caption">
        <button
          type="button"
          aria-label={t("최소화")}
          title={t("최소화")}
          onClick={() => void win.current?.minimize()}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5.5h10" />
          </svg>
        </button>
        <button
          type="button"
          aria-label={maximized ? t("이전 크기로") : t("최대화")}
          title={maximized ? t("이전 크기로") : t("최대화")}
          onClick={() => void win.current?.toggleMaximize()}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            {maximized ? (
              <path d="M0.5 2.5h7v7h-7zM2.5 2.5V0.5h7v7h-2" />
            ) : (
              <path d="M0.5 0.5h9v9h-9z" />
            )}
          </svg>
        </button>
        <button
          type="button"
          className="titlebar__close"
          aria-label={t("닫기")}
          title={t("닫기")}
          onClick={() => void win.current?.close()}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 0l10 10M10 0L0 10" />
          </svg>
        </button>
      </div>
    </header>
  );
}
