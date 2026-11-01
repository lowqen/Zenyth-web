import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * 아래에서 올라오는 모달 시트 — 앱 `ZenythSheet`(UI 개편 P4)를 옮긴 것. 손잡이 · 제목 · 내용 · 오른쪽 끝의
 * 단추([닫기] 다음 [확인]). 무엇을 정하는 물음(지우기 등)은 시트가 아니라 화면을 멈추는 `ConfirmBox` 다.
 *
 * `<dialog>` 의 `showModal()` 이라 초점은 안에 갇히고, Esc · 배경을 누르면 `onClose`. 열고 닫는 것은
 * 부모의 `open` 이 정한다.
 */
export function Sheet({
  open,
  title,
  onClose,
  actions,
  onOpened,
  k,
  children,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  /** 오른쪽 끝의 단추들 — 닫기 쪽이 먼저. */
  actions: ReactNode;
  /** 막 열렸을 때(초점 · 고르기). */
  onOpened?: () => void;
  /** 스모크가 집는 `data-k`. */
  k?: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const opened = useRef(onOpened);
  useEffect(() => {
    opened.current = onOpened;
  });

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // 초점은 시트 자신에 — 브라우저는 첫 링크 · 단추에 주어 링이 그려진다(누르기 전에 고른 것처럼 보인다).
      if (opened.current) opened.current();
      else d.focus();
    } else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="sheet"
      tabIndex={-1}
      data-k={k}
      aria-labelledby={titleId}
      onClose={() => open && onClose()}
      // 바깥(배경)을 누르면 닫는다 — 시트 안의 클릭은 대상이 dialog 자신이 아니다.
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="sheet__inner">
        <div className="sheet__grip" aria-hidden="true" />
        <h2 id={titleId} className="sheet__title">
          {title}
        </h2>
        {children}
        <div className="sheet__actions">{actions}</div>
      </div>
    </dialog>
  );
}
