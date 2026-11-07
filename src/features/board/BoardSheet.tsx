import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { t } from "../../i18n/i18n";

/** 손을 떼었을 때 이만큼(px/ms) 넘게 움직이고 있었으면 그 방향으로 간다 — 거리와 상관없이. */
const FLING = 0.5;

/**
 * 휴대폰 세로의 보드 시트 — 앱 P3 «판 고정 + 스냅 시트»(`BottomSheetScaffold`), 결정 Q4.
 *
 * 판과 툴바는 움직이지 않고, 카드는 아래에서 올라오는 시트에 얹힌다. 시트는 요약 줄(최선수 · 차례)에 얹혀
 * 쉰다 — **피크 = 판과 툴바가 남긴 높이**라 쉬는 동안 판을 한 칸도 가리지 않는다(판의 크기는 base.css 가
 * 「피크가 손잡이 + 요약 줄(88)보다 작아지지 않게」 정한다 — 앱 `portraitMetrics`). 멈춤 자리는 피크와 전체
 * 둘(앱도 둘 — 절반 정지는 드래그 · 중첩 스크롤 · 접근성 동작을 손으로 짜야 한다).
 *
 * - 쉬는 동안: 시트 어디를 끌어도 시트가 움직인다(안의 카드는 스크롤하지 않는다).
 * - 펼친 동안: 손잡이와 요약 줄을 끌어 내리고, 카드는 그 안에서 스크롤한다.
 * - 손잡이는 버튼이다 — 누르면 펼치고 접는다(`aria-expanded`). 키보드 · 화면 낭독기도 같은 길로.
 * - 위치는 끄는 동안 손가락을 그대로 따라가고(전환 없음), 놓으면 가까운 쪽(빠르게 튕겼으면 그 방향)으로
 *   스프링처럼 붙는다. 판 영역이 아니라 크롬이라 미끄러짐이 허용된다(앱 결정 D6).
 */
export function BoardSheet({
  summary,
  children,
  anchorRef,
}: {
  summary: ReactNode;
  children: ReactNode;
  /** 시트가 쉬는 자리의 기준 — 툴바. 그 아래 끝이 피크의 윗변이다. */
  anchorRef: RefObject<HTMLElement | null>;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // 쉬는 자리(툴바 아래 끝, 시트 상자 기준 px). 판 크기가 바뀌면(회전 · 주소창) 다시 잰다.
  // 아직 재지 못했으면 null — 그동안은 화면 밖(아래)에 둔다(판을 덮은 첫 프레임이 번쩍이지 않게).
  const [rest, setRest] = useState<number | null>(null);
  // 끄는 중의 위치(px). null 이면 멈춤 자리(open/rest) 그대로.
  const [dragY, setDragY] = useState<number | null>(null);
  // 끄는 중의 상태는 ref 에 — 핸들러가 렌더 사이의 낡은 상태(dragY)를 읽지 않게. 상태는 그리기에만 쓴다.
  const drag = useRef<{
    id: number;
    y0: number;
    from: number;
    t: number;
    y: number;
    v: number;
    on: boolean;
    cur: number;
  } | null>(null);

  // 레이아웃 효과가 아니라 효과에서 잰다 — 툴바는 이 시트보다 뒤에 오는 형제라, 레이아웃 효과가 도는 순간에는
  // 그 ref 가 아직 붙지 않았다(쉬는 자리가 0 으로 재져 시트가 판을 덮었다).
  useEffect(() => {
    const anchor = anchorRef.current;
    const box = sheet.current?.parentElement;
    if (!anchor || !box) return;
    const measure = () => setRest(anchor.offsetTop + anchor.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    ro.observe(anchor);
    return () => ro.disconnect();
  }, [anchorRef]);

  // 처음 자리는 미끄러지지 않고 바로 — 자리를 잡은 다음 프레임부터 전환을 켠다(화면을 열 때마다 시트가
  // 아래에서 올라오지 않게).
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (rest === null || ready) return;
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, [rest, ready]);
  const restY = rest ?? 0;
  const settled = open ? 0 : restY;
  const y = dragY ?? settled;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // 펼친 동안에는 손잡이 · 요약 줄에서만 끈다 — 카드는 스크롤해야 한다.
    if (open && !(e.target as HTMLElement).closest(".boardsheet__head")) return;
    drag.current = {
      id: e.pointerId,
      y0: e.clientY,
      from: y,
      t: e.timeStamp,
      y: e.clientY,
      v: 0,
      on: false,
      cur: y,
    };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.y0;
    if (!d.on) {
      if (Math.abs(dy) < 6) return;
      d.on = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const dt = Math.max(1, e.timeStamp - d.t);
    d.v = (e.clientY - d.y) / dt;
    d.t = e.timeStamp;
    d.y = e.clientY;
    d.cur = Math.min(restY, Math.max(0, d.from + dy));
    setDragY(d.cur);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.on) return;
    const next = d.v < -FLING ? true : d.v > FLING ? false : d.cur < restY / 2;
    setOpen(next);
    setDragY(null);
    // 끌기가 끝난 직후의 클릭(손잡이 버튼)은 버린다 — 놓은 자리의 버튼이 한 번 더 뒤집지 않게.
    swallow.current = true;
    window.setTimeout(() => (swallow.current = false), 0);
  };
  const swallow = useRef(false);

  return (
    <div
      ref={sheet}
      className="boardsheet"
      data-open={open || undefined}
      data-dragging={dragY !== null || undefined}
      data-ready={ready || undefined}
      style={{ transform: rest === null ? "translateY(100%)" : `translateY(${y}px)` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="boardsheet__head">
        <button
          type="button"
          className="boardsheet__handle"
          aria-expanded={open}
          aria-label={open ? t("카드 접기") : t("카드 펼치기")}
          onClick={() => {
            if (swallow.current) return;
            setOpen(!open);
          }}
        >
          <span className="boardsheet__grip" aria-hidden="true" />
        </button>
        {summary}
      </div>
      <div className="boardsheet__body">{children}</div>
    </div>
  );
}
