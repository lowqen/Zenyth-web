// 페인트 전에 테마를 확정한다 — index.html 이 <head> 의 동기 스크립트로 부른다. 이게 없으면 다크
// 사용자가 첫 프레임에 흰 화면을 한 번 본다(FOUC). 3상태 중 명시 선택만 data-theme 로 붙는다.
// 예전에는 index.html 의 인라인 <script> 였다. CSP(script-src 'self')가 인라인 스크립트를 막으므로
// 파일로 뺐다(docs/engineering-notes.md §4 Phase 1).
// 검은 배경(AMOLED)은 다크 위의 덧씌움이라 따로 붙인다 — 어떤 색을 바꿀지는 tokens.css 가 정한다.
// 데스크톱 Z2: Tauri 셸 안이면 첫 프레임부터 데스크톱 밀도 · 타이틀바 칸(:root[data-desktop], src/app/desktop/platform.ts).
if ("__TAURI_INTERNALS__" in window) document.documentElement.dataset.desktop = "";
try {
  const t = localStorage.getItem("rapfi.theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  if (localStorage.getItem("rapfi.amoled") === "1") document.documentElement.dataset.amoled = "";
} catch {
  /* 사생활 보호 모드 등 — 무시하고 system 으로 둔다 */
}
