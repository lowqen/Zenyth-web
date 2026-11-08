import { create } from "zustand";
import {
  addIncrement,
  freshClock,
  playerTimedOut,
  startClock,
  tickClock,
  withLimits,
  type ClockLimits,
  type ClockSide,
  type GameClock,
} from "../../core/model/clock";

/**
 * 대국 시계의 스토어(데스크톱 Z4) — 대국 스토어와 따로 둔다. 시계는 250ms 마다 바뀌는데, 대국 스토어를 구독하는
 * 쪽(자동 저장 · 설정 파일 맞추기 · 분석 따라가기)이 그때마다 깨면 안 된다. 시계를 움직이는 것(누구 차례인가 ·
 * 증분)은 대국 스토어가 이 스토어의 손잡이로 한다 — 이 스토어는 대국을 모른다.
 *
 * 한도는 설정에서 온다: 대국 한도 · 수당 증분은 여기 설정, 차례 한도는 대국의 「엔진 착수 시간」(0 이면 대국
 * 한도). 데스크톱의 `timeout_turn` · `timeout_match` · `increment` 와 같은 뜻이다.
 */

export interface ClockSettings {
  /** 시계를 쓴다 — 켜면 엔진도 이 시간으로 둔다(`timeout_match` · `time_left`). */
  enabled: boolean;
  /** 대국 한도(초) — 한 사람 몫. */
  matchSec: number;
  /** 한 수마다 더해 주는 시간(초). */
  incrementSec: number;
  /** 사람의 시간이 다 되면 알린다(데스크톱 «시간 초과 확인»). */
  checkTimeout: boolean;
}

export const CLOCK_DEFAULTS: ClockSettings = {
  enabled: false,
  matchSec: 600,
  incrementSec: 0,
  checkTimeout: true,
};

export const MATCH_SEC_CHOICES = [60, 180, 300, 600, 900, 1800, 3600] as const;
export const INCREMENT_SEC_CHOICES = [0, 2, 5, 10, 30] as const;

const KEY = "zenyth.clock";
const TICK_MS = 250;

function load(): ClockSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<ClockSettings> | null;
    return raw ? sanitize({ ...CLOCK_DEFAULTS, ...raw }) : CLOCK_DEFAULTS;
  } catch {
    return CLOCK_DEFAULTS;
  }
}

function save(s: ClockSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 저장이 안 돼도 이번 세션은 그대로 돈다 */
  }
}

function sanitize(s: ClockSettings): ClockSettings {
  const num = (v: unknown, lo: number, hi: number, d: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d;
  return {
    enabled: Boolean(s.enabled),
    matchSec: num(s.matchSec, 1, 10_000_000, CLOCK_DEFAULTS.matchSec),
    incrementSec: num(s.incrementSec, 0, 200, CLOCK_DEFAULTS.incrementSec),
    checkTimeout: Boolean(s.checkTimeout),
  };
}

/** 설정 + 엔진 착수 시간 → 시계 한도. */
export function limitsOf(s: ClockSettings, moveTimeMs: number): ClockLimits {
  const matchLimitMs = s.matchSec * 1000;
  return {
    limited: s.enabled,
    matchLimitMs,
    turnLimitMs: moveTimeMs > 0 ? moveTimeMs : matchLimitMs,
    incrementMs: s.incrementSec * 1000,
  };
}

interface ClockState {
  settings: ClockSettings;
  clock: GameClock;
  /** 대국 탭에서 승부가 나지 않았다 — 이때만 흐른다(대국 스토어가 정한다). */
  active: boolean;
  /** 엔진 착수 시간(ms) — 차례 한도가 된다. 대국 스토어가 넣는다. */
  moveTimeMs: number;
  setSettings: (patch: Partial<ClockSettings>) => void;
  setMoveTime: (ms: number) => void;
  setActive: (on: boolean) => void;
  /** 새 대국 — 쓴 시간을 비우고 사람 차례로 시작한다(앱 · 데스크톱과 같다). */
  reset: () => void;
  /** `side` 의 차례가 시작된다. */
  start: (side: ClockSide) => void;
  /** `side` 가 한 수를 마쳤다 — 증분을 번다. */
  credit: (side: ClockSide) => void;
}

let ticker: ReturnType<typeof setInterval> | null = null;
let lastTick = 0;

export const useClockStore = create<ClockState>()((set, get) => {
  const settings = load();
  const limits = () => limitsOf(get().settings, get().moveTimeMs);
  return {
    settings,
    clock: freshClock(limitsOf(settings, 0), "human"),
    active: false,
    moveTimeMs: 0,
    setSettings: (patch) => {
      const next = sanitize({ ...get().settings, ...patch });
      save(next);
      set({ settings: next });
      set({ clock: withLimits(get().clock, limits()) });
    },
    setMoveTime: (ms) => {
      if (ms === get().moveTimeMs) return;
      set({ moveTimeMs: ms });
      set({ clock: withLimits(get().clock, limits()) });
    },
    setActive: (active) => {
      if (active !== get().active) set({ active });
    },
    reset: () => set({ clock: freshClock(limits(), "human") }),
    start: (side) => set({ clock: startClock(get().clock, side) }),
    credit: (side) => set({ clock: addIncrement(get().clock, side) }),
  };
});

/** 한 번의 틱 — 지난 틱 뒤로 흐른 시간을 지금 차례에 더하고, 사람의 시간이 다 됐으면 한 번 표시한다. */
export function tickClockNow(deltaMs: number): void {
  const s = useClockStore.getState();
  if (!s.active || !s.settings.enabled || !s.clock.running) return;
  const ticked = tickClock(s.clock, deltaMs);
  const warn = s.settings.checkTimeout && !ticked.timedOutNotified && playerTimedOut(ticked);
  useClockStore.setState({ clock: warn ? { ...ticked, timedOutNotified: true } : ticked });
}

/** 흐를 조건일 때만 타이머를 둔다 — 시험(노드)과 시계를 끈 사용자에게 도는 타이머가 없게. */
function syncTicker() {
  const s = useClockStore.getState();
  const want = s.active && s.settings.enabled && s.clock.running !== null;
  if (want && !ticker) {
    lastTick = Date.now();
    ticker = setInterval(() => {
      const now = Date.now();
      tickClockNow(now - lastTick);
      lastTick = now;
    }, TICK_MS);
  } else if (!want && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}
useClockStore.subscribe(syncTicker);
