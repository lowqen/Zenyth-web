import { useRef } from "react";
import { t } from "../i18n/i18n";
import { useCopySheet } from "./copySheetStore";
import { Sheet } from "./Sheet";

/** 직접 복사하게 보여 주는 시트(`copySheetStore.ts`). 셸에 하나 — 어느 화면에서 불러도 같은 시트가 뜬다. */
export function CopySheetHost() {
  const open = useCopySheet((s) => s.open);
  const close = useCopySheet((s) => s.close);
  const field = useRef<HTMLTextAreaElement>(null);

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
    <Sheet
      open={open !== null}
      title={open?.title}
      onClose={close}
      onOpened={() => field.current?.select()}
      k="copy-sheet"
      actions={
        <>
          <button type="button" className="ghostbtn" onClick={close}>
            {t("닫기")}
          </button>
          <button type="button" className="cta" onClick={copyAgain}>
            {t("복사")}
          </button>
        </>
      }
    >
      <textarea
        ref={field}
        className="sheet__field tnum"
        readOnly
        rows={3}
        value={open?.text ?? ""}
        aria-label={open?.title}
        onFocus={(e) => e.currentTarget.select()}
      />
    </Sheet>
  );
}
