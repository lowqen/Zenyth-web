import { useEffect, useRef } from "react";
import { t } from "../i18n/i18n";
import { useCopySheet } from "./copySheetStore";

/** 직접 복사하게 보여 주는 시트(`copySheetStore.ts`). 셸에 하나 — 어느 화면에서 불러도 같은 시트가 뜬다. */
export function CopySheetHost() {
  const open = useCopySheet((s) => s.open);
  const close = useCopySheet((s) => s.close);
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      field.current?.select();
    } else if (!open && d.open) d.close();
  }, [open]);

  const copyAgain = async () => {
    if (!open) return;
    field.current?.select();
    try {
      await navigator.clipboard.writeText(open.text);
      close();
    } catch {
      // 여기서도 안 되면 고른 채로 둔다 — 손으로(Ctrl+C · 길게 눌러) 복사한다.
      field.current?.focus();
    }
  };

  return (
    <dialog
      ref={dialog}
      className="sheet"
      data-k="copy-sheet"
      aria-labelledby="copy-sheet-title"
      onClose={close}
      // 바깥(배경)을 누르면 닫는다 — 시트 안의 클릭은 대상이 dialog 자신이 아니다.
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div className="sheet__inner">
        <div className="sheet__grip" aria-hidden="true" />
        <h2 id="copy-sheet-title" className="sheet__title">
          {open?.title}
        </h2>
        <textarea
          ref={field}
          className="sheet__field tnum"
          readOnly
          rows={3}
          value={open?.text ?? ""}
          aria-label={open?.title}
          onFocus={(e) => e.currentTarget.select()}
        />
        <div className="sheet__actions">
          <button type="button" className="ghostbtn" onClick={close}>
            {t("닫기")}
          </button>
          <button type="button" className="cta" onClick={copyAgain}>
            {t("복사")}
          </button>
        </div>
      </div>
    </dialog>
  );
}
