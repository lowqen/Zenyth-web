// 페인트 전에 테마를 확정한다 — index.html 이 <head> 의 동기 스크립트로 부른다. 이게 없으면 다크
// 사용자가 첫 프레임에 흰 화면을 한 번 본다(FOUC). 3상태 중 명시 선택만 data-theme 로 붙는다.
// 예전에는 index.html 의 인라인 <script> 였다. CSP(script-src 'self')가 인라인 스크립트를 막으므로
// 파일로 뺐다(docs/engineering-notes.md §4 Phase 1).
// 검은 배경(AMOLED)은 다크 위의 덧씌움이라 따로 붙인다 — 어떤 색을 바꿀지는 tokens.css 가 정한다.
// 데스크톱 Z2: Tauri 셸 안이면 첫 프레임부터 데스크톱 밀도 · 타이틀바 칸(:root[data-desktop], src/app/desktop/platform.ts).
// 데스크톱 Z6: 창은 숨긴 채 뜬다(tauri.conf.json `visible: false`). 첫 프레임(배경 · index.html 의 골격 타이틀바)이 그려지면
// 곧바로 보인다 — 번들 · React 를 기다리지 않는다. 이 IPC 가 페이지의 첫 IPC 라 뒤에 줄 서지 않는다(전에는 bridge.ts 가
// 테마 · 최대화 · 설정 · 엔진 IPC 와 함께 불러 내비 시작 뒤 2.5~7.5초에 보였다, 계획서 §9.10). bridge.ts 의 show 는 대비책.
if ("__TAURI_INTERNALS__" in window) {
  document.documentElement.dataset.desktop = "";
  // 렌더를 막는 스타일시트가 오기 전에는 rAF 가 돌지 않는다 — 두 번째 rAF 는 첫 프레임이 나간 뒤다.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      window.__zenythShowAt = performance.now();
      Promise.resolve(
        window.__TAURI_INTERNALS__.invoke("plugin:window|show", { label: "main" }),
      ).catch(() => {});
    }),
  );
} else if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
  // 데스크톱 배치 미리 보기(engineering-notes §13) — 개발 서버에서만. `?desktop` 으로 켜고 `?desktop=0` 으로 끈다.
  // 탭을 닫을 때까지 기억한다(sessionStorage). 배치(DESKTOP_LAYOUT)만 바뀌고 셸 기능(IS_DESKTOP)은 꺼진 그대로다 —
  // scripts/shots.ts 의 데스크톱 폭 골든과 같은 상태. 배포 주소에서는 이 갈래에 들어오지 않는다.
  try {
    const q = new URLSearchParams(location.search).get("desktop");
    if (q !== null) sessionStorage.setItem("zenyth.desktopPreview", q === "0" ? "0" : "1");
    if (sessionStorage.getItem("zenyth.desktopPreview") === "1")
      document.documentElement.dataset.desktop = "";
  } catch {
    /* 저장소를 막은 브라우저 — 미리 보기 없이 웹 배치 */
  }
}
try {
  const t = localStorage.getItem("rapfi.theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  if (localStorage.getItem("rapfi.amoled") === "1") document.documentElement.dataset.amoled = "";
} catch {
  /* 사생활 보호 모드 등 — 무시하고 system 으로 둔다 */
}
