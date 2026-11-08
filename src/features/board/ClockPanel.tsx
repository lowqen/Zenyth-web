import { Chip, ChipGroup, Switch } from "../../components/controls";
import { leftLabel, usedLabel, type ClockSide } from "../../core/model/clock";
import { t } from "../../i18n/i18n";
import { INCREMENT_SEC_CHOICES, MATCH_SEC_CHOICES, useClockStore } from "./clockStore";

/**
 * 대국 시계(데스크톱 Z4) — 데스크톱의 시계 창을 대국 카드 안으로 옮겼다(계획 §3.4). 두 줄: 엔진과 사람.
 * 각 줄은 남은 시간 «차례 / 대국»과 쓴 시간이다(데스크톱 라벨과 같은 순서). 지금 재는 쪽은 `data-on`.
 */
export function ClockView() {
  const clock = useClockStore((s) => s.clock);
  const active = useClockStore((s) => s.active);
  const side = (who: ClockSide, name: string) => (
    <div
      className="clock__row"
      data-k={`clock-${who}`}
      data-on={(active && clock.running === who) || undefined}
    >
      <span className="clock__who">{name}</span>
      <span className="clock__left tnum">{leftLabel(clock, who)}</span>
      <span className="clock__used tnum" title={t("쓴 시간 (차례 / 대국)")}>
        {usedLabel(clock, who)}
      </span>
    </div>
  );
  return (
    <div className="clock" role="timer" aria-label={t("대국 시계")}>
      {side("computer", t("엔진"))}
      {side("human", t("사람"))}
    </div>
  );
}

const minLabel = (sec: number) =>
  sec < 60 ? t("{n}초", { n: sec }) : t("{n}분", { n: Math.round(sec / 60) });

/** 시계 설정 — 켜기 · 대국 한도 · 수당 증분 · 시간 초과 알림. 차례 한도는 「엔진 착수 시간」이다. */
export function ClockControl() {
  const s = useClockStore((st) => st.settings);
  const set = useClockStore((st) => st.setSettings);
  return (
    <div className="stack">
      <Switch label={t("대국 시계")} on={s.enabled} onChange={(enabled) => set({ enabled })} />
      {s.enabled && (
        <>
          <ChipGroup label={t("대국 시간")}>
            {MATCH_SEC_CHOICES.map((sec) => (
              <Chip key={sec} on={s.matchSec === sec} onClick={() => set({ matchSec: sec })}>
                {minLabel(sec)}
              </Chip>
            ))}
          </ChipGroup>
          <ChipGroup label={t("수당 추가 시간")}>
            {INCREMENT_SEC_CHOICES.map((sec) => (
              <Chip
                key={sec}
                on={s.incrementSec === sec}
                onClick={() => set({ incrementSec: sec })}
              >
                {sec === 0 ? t("없음") : t("+{n}초", { n: sec })}
              </Chip>
            ))}
          </ChipGroup>
          <Switch
            label={t("시간이 다 되면 알리기")}
            on={s.checkTimeout}
            onChange={(checkTimeout) => set({ checkTimeout })}
          />
        </>
      )}
    </div>
  );
}
