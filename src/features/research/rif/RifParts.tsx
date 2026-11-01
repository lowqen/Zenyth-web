import { useRef, useState } from "react";
import { Segmented } from "../../../components/controls";
import { RIF_ACCEPT, useRifStore } from "./rifStore";
import { fmtInt, pct } from "./format";
import { t } from "../../../i18n/i18n";

/**
 * W7 의 작은 부품들 — 승·무·패 막대, 파일 고르기 단추, 자료 출처 줄. 랭킹 · 오프닝 화면이 함께 쓴다.
 * 데이터가 없을 때의 안내는 `GameData.tsx`(Z7).
 */

/**
 * 흑승 · 무 · 백승 막대 — 결과 배지와 같은 세 색(흑 = 파랑 · 백 = 초록 · 무 = 중립). 글자는 막대
 * 옆에 흑 점수(무 = 반 점)로 하나만 — 세 숫자를 다 쓰면 목록이 읽히지 않는다. 자세한 것은 툴팁.
 */
export function WdlBar({
  b,
  d,
  w,
  compact,
}: {
  b: number;
  d: number;
  w: number;
  compact?: boolean;
}) {
  const n = b + d + w;
  const title = n
    ? t("흑 승 {b} ({bp}%) · 무 {d} ({dp}%) · 백 승 {w} ({wp}%)", {
        b: fmtInt(b),
        bp: pct(b, n),
        d: fmtInt(d),
        dp: pct(d, n),
        w: fmtInt(w),
        wp: pct(w, n),
      })
    : t("결과가 난 판이 없습니다");
  const score = n ? Math.round(((b + d / 2) / n) * 100) : null;
  return (
    <span className={"wdl" + (compact ? " wdl--compact" : "")} title={title} aria-label={title}>
      <span className="wdl__bar" aria-hidden="true">
        {n > 0 ? (
          <>
            <span className="wdl__b" style={{ width: `${(b / n) * 100}%` }} />
            <span className="wdl__d" style={{ width: `${(d / n) * 100}%` }} />
            <span className="wdl__w" style={{ width: `${(w / n) * 100}%` }} />
          </>
        ) : (
          <span className="wdl__none" />
        )}
      </span>
      <span className="wdl__score tnum">
        {score === null ? t("없음") : t("흑 {b}%", { b: score })}
      </span>
    </span>
  );
}

/** 파일 고르기 버튼 — 숨은 `<input type=file>` 을 대신 누른다. */
export function PickRifButton({ label, tonal }: { label?: string; tonal?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const importFile = useRifStore((s) => s.importFile);
  const busy = useRifStore((s) => s.job !== null);
  return (
    <>
      <button
        type="button"
        className={"btn" + (tonal ? " btn--tonal" : "")}
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {label ?? t("파일 고르기")}
      </button>
      <input
        ref={input}
        type="file"
        accept={RIF_ACCEPT}
        hidden
        data-k="rif-input"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (f) void importFile(f);
        }}
      />
    </>
  );
}

/**
 * 지금 보고 있는 자료 — RenjuNet(날짜 · 판 수) 또는 내 기보. 둘 다 있으면 고른다. 다시 만들기 ·
 * 지우기는 여기서.
 */
export function PackSourceBar() {
  const pack = useRifStore((s) => s.pack);
  const local = useRifStore((s) => s.local);
  const source = useRifStore((s) => s.source);
  const setSource = useRifStore((s) => s.setSource);
  const remove = useRifStore((s) => s.remove);
  const [asking, setAsking] = useState(false);
  const showing =
    source === "renjunet" && pack ? "renjunet" : local ? "local" : pack ? "renjunet" : null;
  if (!showing) return null;
  return (
    <div className="packbar" data-k="pack-source">
      {pack && local ? (
        <Segmented
          label={t("자료")}
          value={showing}
          options={[
            { value: "renjunet", label: "RenjuNet" },
            { value: "local", label: t("내 기보") },
          ]}
          onChange={setSource}
        />
      ) : (
        <span className="pill">{showing === "renjunet" ? "RenjuNet" : t("내 기보")}</span>
      )}
      <span className="packbar__meta tnum">
        {showing === "renjunet" && pack
          ? t("{n}판 · {date} 판", {
              n: fmtInt(pack.games.id.length),
              date: pack.date || t("날짜 모름"),
            })
          : local
            ? t("{n}판: 저장한 기보와 지금 판", { n: fmtInt(local.games.id.length) })
            : ""}
      </span>
      <span className="packbar__actions">
        {pack && asking ? (
          <span className="packbar__confirm" role="alert">
            {t("RenjuNet 통계를 지울까요? 다시 보려면 파일을 다시 넣어야 합니다.")}
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                setAsking(false);
                void remove();
              }}
            >
              {t("지우기")}
            </button>
            <button type="button" className="btn" autoFocus onClick={() => setAsking(false)}>
              {t("그대로 두기")}
            </button>
          </span>
        ) : pack ? (
          <>
            <PickRifButton label={t("새 파일로 다시")} />
            <button type="button" className="btn" onClick={() => setAsking(true)}>
              {t("지우기")}
            </button>
          </>
        ) : (
          <PickRifButton label={t("RenjuNet 파일 넣기")} tonal />
        )}
      </span>
    </div>
  );
}
