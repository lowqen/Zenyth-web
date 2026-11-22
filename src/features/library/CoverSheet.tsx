import { useState } from "react";
import { Sheet } from "../../components/Sheet";
import { Chip, ChipGroup } from "../../components/controls";
import { Icon } from "../../components/icons";
import { ICON } from "../../components/icon-paths";
import { ABBR, nameOf } from "../../core/opening/opening26";
import type { LibraryCover, LibraryMetaRow } from "../../data/library";
import { t } from "../../i18n/i18n";
import { DbCover } from "./DbCover";
import { coverKeyOf } from "./cover";

/**
 * 커버 시트(라이브러리 계획 §6 «커버») — 실시간 미리 보기 · [자동] [일식] · 直 13 / 間 13 미니 커버 격자 · 체크 원.
 * 고른 것은 [확인]을 눌러야 적는다.
 */
export function CoverSheet({
  entry,
  open,
  onClose,
  onSave,
}: {
  entry: LibraryMetaRow;
  open: boolean;
  onClose: () => void;
  onSave: (cover: LibraryCover) => void;
}) {
  const [draft, setDraft] = useState<LibraryCover>(entry.cover);
  const [openedFor, setOpenedFor] = useState(open);
  // 다시 열 때마다 항목의 지금 커버에서 시작한다(렌더 중 맞추기).
  if (open !== openedFor) {
    setOpenedFor(open);
    if (open) setDraft(entry.cover);
  }
  const key = coverKeyOf(draft, entry.stats);
  const pickOpening = (i: number) => setDraft({ ...draft, mode: "opening", opening: i });
  const grid = (from: number) => (
    <div
      className="coversheet__grid"
      role="radiogroup"
      aria-label={from === 0 ? t("직접") : t("간접")}
    >
      {Array.from({ length: 13 }, (_, j) => from + j).map((i) => {
        const on = draft.mode === "opening" && draft.opening === i;
        return (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={on}
            className="coversheet__cell"
            title={`${ABBR[i]} ${nameOf(i)}`}
            onClick={() => pickOpening(i)}
          >
            <DbCover k={i} />
            {on && (
              <span className="coversheet__check" aria-hidden="true">
                <Icon d={ICON.check} />
              </span>
            )}
            <span className="coversheet__name">{nameOf(i)}</span>
          </button>
        );
      })}
    </div>
  );
  return (
    <Sheet
      open={open}
      title={t("커버")}
      onClose={onClose}
      k="cover-sheet"
      actions={
        <>
          <button type="button" className="ghostbtn" onClick={onClose}>
            {t("닫기")}
          </button>
          <button
            type="button"
            className="cta"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            {t("확인")}
          </button>
        </>
      }
    >
      <div className="coversheet">
        <div className="coversheet__preview">
          <DbCover k={key} seed={draft.seed} label={entry.title} />
        </div>
        <ChipGroup label={t("커버")}>
          <Chip on={draft.mode === "auto"} onClick={() => setDraft({ ...draft, mode: "auto" })}>
            {t("자동")}
          </Chip>
          <Chip
            on={draft.mode === "eclipse"}
            onClick={() =>
              setDraft(
                draft.mode === "eclipse"
                  ? { ...draft, seed: (draft.seed + 1) % 48 }
                  : { ...draft, mode: "eclipse" },
              )
            }
            title={t("다시 누르면 무늬가 바뀝니다")}
          >
            {t("일식")}
          </Chip>
        </ChipGroup>
        <p className="panel__hint">
          {draft.mode === "auto"
            ? t("가장 많은 주형의 색입니다. 분류된 국면이 없으면 일식입니다.")
            : draft.mode === "eclipse"
              ? t("다시 누르면 무늬가 바뀝니다")
              : `${ABBR[draft.opening ?? 0]} ${nameOf(draft.opening ?? 0)}`}
        </p>
        <h3 className="coversheet__group">{t("직접")}</h3>
        {grid(0)}
        <h3 className="coversheet__group">{t("간접")}</h3>
        {grid(13)}
      </div>
    </Sheet>
  );
}
