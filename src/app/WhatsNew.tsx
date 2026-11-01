import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/icons";
import { ICON } from "../components/icon-paths";
import { ZenythMark } from "../components/ZenythMark";
import { t } from "../i18n/i18n";
import { RELEASE_NAME, useFirstVisit } from "./firstVisit";
import { RELEASE_NOTES } from "./releaseNotes";

const RELEASES_URL = "https://github.com/lowqen/Zenyth-web/commits/main";

/**
 * 새로워진 점 — 전에 온 사람이 새 배포를 처음 열 때 한 번(앱 `WhatsNewOnUpdate`), 그리고 설정 ▸ 정보에서
 * 언제든. 마크 · «새로워진 점» · 두 줄 환영 · ✕, 환영 한 문장과 제목 붙은 짧은 묶음, 아래로 더 있으면 흐려짐,
 * 채운 알약 하나와 전체 기록 링크.
 */
export function WhatsNewWindow() {
  const open = useFirstVisit((s) => s.whatsNew);
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
