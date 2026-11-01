/**
 * 앱의 마크 — 런처 아이콘의 «일식»(먹 돌이 진주 돌 앞을 지나고, 그 사이를 메이플 한 줄이 가른다)을 화면 안에서
 * 쓰는 것. 앱 `ZenythMark.kt` 와 같은 100 단위 기하 · 같은 색이고, 색은 테마가 아니라 그림의 것이다(다크에서도
 * 같다). 파비콘 · PWA 아이콘(`public/`)도 같은 그림이다.
 */
export function ZenythMark({ size = 44, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={"zmark" + (className ? ` ${className}` : "")}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
      <rect width="100" height="100" rx="28" fill="#DDB27C" />
      <circle cx="60" cy="50" r="23" fill="#F6F1E9" />
      <circle cx="41" cy="50" r="25.25" fill="#DDB27C" />
      <circle cx="41" cy="50" r="20.75" fill="#171513" />
    </svg>
  );
}
