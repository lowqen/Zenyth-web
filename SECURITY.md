# Security

## Reporting a vulnerability

Please report privately, not in a public issue:
**[Report a vulnerability](https://github.com/lowqen/Zenyth-web/security/advisories/new)**
(GitHub's private vulnerability reporting; only the maintainer sees it).

Say what is affected, how to reproduce it, and what an attacker gains. A
crashing input (a link, a game file, a settings file, a `.rif`) is welcome as an
attachment. This is a one-person project, so replies are best effort; a fix for
anything real is deployed as soon as it is ready, and you are credited in the
commit unless you would rather not be.

## Supported versions

Only what is live at [zenythweb.pages.dev](https://zenythweb.pages.dev) gets
fixes. Every push to `main` is deployed there, so a fix reaches you the next
time the page loads. The old address, `rapfiweb.pages.dev`, only redirects to it.

## What is in scope

Zenyth Web is a static site: no account, no server of its own, no payments,
and everything you save stays in your browser (IndexedDB). What matters:

* **The deploy path.** Anything that could publish to the site without the
  maintainer: this repository's settings, its GitHub Actions workflows and the
  Cloudflare token they hold, and the engine release the deploy downloads
  (`engine-*` tags, checked against `src/engine/engine-manifest.json`).
* **Input from outside.** Links any page can open the site with
  (`/board?p=…`, `/joseki?lesson=…`), files you open or drop (game records,
  desktop settings files, joseki JSON, the RenjuNet `.rif`), and the published
  joseki curriculum. A crash from any of these is a bug worth reporting;
  script running in the page, or data leaving the browser, is a vulnerability.
* **The isolation and CSP headers** (`public/_headers`). The site relies on
  them to keep the engine's `SharedArrayBuffer` safe and to stop injected
  script; a response that misses them, or a way around them, is in scope.

Not in scope: an attacker who already controls your browser or device (a
malicious extension, a compromised machine), and the RenjuNet data itself,
which you download from renju.net and which never leaves your browser.

---

## 한국어 요약

* **취약점 제보는 공개 이슈가 아니라 [비공개 제보](https://github.com/lowqen/Zenyth-web/security/advisories/new)로.**
  무엇이 영향을 받는지, 재현 방법, 공격자가 얻는 것을 적어 주세요. 1인 프로젝트라 답은 최선을 다하는
  수준이고, 실제 문제는 고치는 대로 배포하며 원하면 커밋에 이름을 올립니다.
* **지원 판:** [zenythweb.pages.dev](https://zenythweb.pages.dev) 에 떠 있는 것만. `main` 에 들어가면
  바로 배포되므로 다음에 페이지를 열 때 고친 판이 뜹니다. 옛 주소 `rapfiweb.pages.dev` 는 넘겨 주기만 합니다.
* **대상:** 배포 경로(저장소 설정 · 워크플로 · Cloudflare 토큰 · `engine-*` 엔진 릴리스), 밖에서 오는 입력
  (국면 · 레슨 링크, 여는 파일, 공식 커리큘럼), 격리 · CSP 헤더(`public/_headers`). 페이지에서 스크립트가
  돌거나 자료가 브라우저 밖으로 나가면 취약점입니다.
* **대상 아님:** 이미 브라우저 · 기기를 장악한 공격자(악성 확장 등), renju.net 에서 직접 받는 RenjuNet 자료.
