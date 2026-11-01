# 개발 기록 — 결정과 측정

2026-11 까지의 계획서 · 결과 보고서 열 개(W0 · W0c 스파이크, 엔진 최적화 마스터플랜, gomocalc 탑재 비교 · 대국 분석,
보안 강화, 오프닝 협상, 공식 커리큘럼 설계, 디자인 토큰 대조, 앱 디자인 정렬)를 압축한 것이다. 남긴 것은 **코드 주석이
근거로 가리키는 결정 · 측정 · 「하지 않은 것」 · 열린 일** 뿐이다. 단계별 진행 기록 · 원자료 표 · upstream 이슈 초안의
원문은 git 이력에 있다(`git log -- docs/`, 2026-11-02 정리 이전).

주석의 `§N ID` 는 이 문서의 절 번호와 그 절 안의 ID 다(예: `§2 A4` = 엔진 최적화 절의 A4). 계속 쓰는 문서는 따로 있다:
[`기능-안내.md`](기능-안내.md)(화면별 상세) · [`배포-cloudflare.md`](배포-cloudflare.md) · [`공식-정석-관리.md`](공식-정석-관리.md).

---

## §1. 엔진을 브라우저로 — W0 · W0c 스파이크 (2026-08-31 ~ 09-29)

기준 upstream `dhbloo/rapfi@3c94c2a9`, Networks `e32ad77a`, Emscripten 6.0.8.

| ID | 내용 | 결과 |
|---|---|---|
| W0-1 | stdin 왕복 | upstream `emscripten/preamble.js` 의 **펌프**(`sendCommand` → `gomocupLoopOnce`)를 쓴다 — 엔진이 stdin 에서 막히지 않아 단일 변형은 `Atomics.wait` 가 필요 없다. 기동 ~300ms, 메인 스레드 지연 0.5ms |
| W0-2 | Emscripten 빌드 | 변형은 **SIMD 둘**(`single` · `multi`) — `mix10nnue.cpp` 의 `static_assert` 가 스칼라 백엔드를 거부해 비SIMD 빌드가 없다. 지원 하한 Chrome/Edge 91 · Firefox 89 · Safari 16.4(보안 결정 뒤 97 · 102 · 16 — §4) |
| W0-3 | BENCH 해시가 폰과 다름 | **엔진의 답은 같다.** `benchmark.cpp` 가 `size_t nodes` 를 객체 표현 그대로 해시에 넣어 wasm32(4바이트)와 64비트(8바이트)의 스트림이 갈린다. 확정 실험 run 33469545091. 웹 BENCH 는 웹 전용 기준선(`spike/web-baseline.json`)으로 회귀만 막는다. upstream 이슈는 **미제출**(초안은 git 이력의 `docs/W0-결과.md` 부록) |
| W0-4 | `.data` 는 렌주 가중치만 | Cloudflare 파일당 25MB 상한 → 40.3MB 를 19.87MB 로(2026-09-03). BENCH 국면 10개 중 7개가 프리스타일 · 스탠다드라 폴백으로 돌아 노드 4,391,204 → 7,170,518, 해시가 바뀌었다(엔진이 아니라 준 가중치가 바뀐 것). 그래서 BENCH 는 렌주 회귀 신호로 약하다 — 배포 구성의 기능 게이트는 `scripts/engine-smoke.ts` |
| C1 | 멀티 변형이 도는가 | chromium · firefox · webkit 셋 다, **COOP/COEP 격리 아래에서만**(헤더 없으면 셋 다 무응답 — `public/_headers` 가 그래서 있다). 격리가 안 되면 앱은 단일 변형으로 물러선다. 멀티 빌드의 1 스레드는 단일과 잡음 안에서 같다 |
| C2 | 전용 워커에서 무응답이던 이유 | `importScripts` 로 읽힌 글루에게 `self.location` 은 호스트 워커라, pthread 가 글루 대신 호스트 워커를 띄웠다. 해법: 워커 머리에서 `self.name === "em-pthread"` 면 글루만 읽고 비킨다(`engine-worker.ts`) |
| C3 | 정지 | `YXSTOP` → 좌표 1~9ms, 탐색 명령이 호출자를 붙드는 시간 0ms(멀티). 단일은 탐색 동안 호스트를 통째로 붙든다(그래서 500ms 조각) |
| C4 | **입력 경합**(2026-09-29) | 엔진은 좌표를 찍은 뒤에도 탐색 스레드가 잠깐 stdin 을 읽는다 — 그 틈의 명령이 토막 나거나(`ERROR Unknown command: 2`) 사라지고, 사라진 것이 탐색 명령이면 영원히 조용하다. 대응: 좌표 뒤 **50ms 정착 대기**(관측 안전선 5ms 의 10배, `quiet()`), 탐색 중에는 `YXSTOP` 만, 5초 무응답 감시, 멀티가 `fatal` 이면 단일로 자동 복구(`recoverToSingle`). 하네스(`spike/w0c/probe.js` · `bench/gomocalc/lib.mjs`)도 같은 50ms |

**재지 못한 것.** 4 스레드 이상의 효과(잰 기계가 모두 2코어), 실제 Safari · iOS. 멀티 탐색은 `MESSAGE Speed` 없이 끝나기도
해 속도는 `TOTALNODES/TOTALTIME` 으로 잰다.

---

## §2. 엔진 최적화 — 마스터플랜 (1부 2026-09-30 ~ 10-04, 2부 10-04 ~ 10-27)

**배포 구성.** `engine-3c94c2a9-a4` = upstream `3c94c2a9` + **P2-2 + A1 + P4-1 + A3 + A4 + W8**, `wasm-opt -O4 --converge`(P2-6),
변형 4종(multi/single × simd128/relaxed — 2-a), 렌주 흑/백 가중치(`rapfi.data` 19,865,582B). 웹 BENCH 기준선 **bb7888cc ·
7,465,395 노드**. 패치 목록의 정본은 `engine-release.yml` 의 `RAPFI_PATCHES` 와 `public/engine/ENGINE_VERSION.txt`.

| 릴리스 | 더한 것 |
|---|---|
| `-mt` · `-rx` | 멀티스레드 변형 · relaxed SIMD 변형(패치 없음) |
| `-p2` | P2-2 · P2-6 (BENCH 2b7c7da9) |
| `-a1` · `-a1n` · `-a3` · `-w8` | A1(BENCH → bb7888cc) · P4-1 · A3 · W8(글루가 `FS` 를 내보냄, 탐색 불변) |
| **`-a4`** | A4(모든 변형) · Emscripten 6.0.13 — 2026-10-27 배포 |

### 세 질문의 답(1부)

- **질문 1 — 전술 수읽기 격차(1 스레드 +M43 누락).** 모델 · 가지치기 매개변수 · VCF 제한이 아니다(가중치 SHA · `parameter.h`
  diff 0줄). 갈림은 ply 2 방어 하나를 증명하는 **순서**이고, 방어를 고정하면 우리가 더 빨리 푼다. 2 스레드에서는 루트 필승이
  3.4배 빠르다. 체계적 약화의 증거 없음.
- **질문 2 — 핫패스.** NNUE 가 **77%**: `Accumulator::move` 32.6% · `starBlock<64,64>` 30.1% · `evaluatePolicy` 11.6% ·
  `Board::move` 4.9% · 정렬 4.3%. 간접 호출 · TT · 스택은 각 **0.3% 미만** — 손대도 안 움직인다(`profile-engine.yml`).
  wasm 고유 손실은 i8 내적(8명령 → relaxed 1명령) · `mulhi` 3명령 · prefetch 소실.
- **질문 3 — 멀티스레드.** 가장 큰 손실은 동기화가 아니라 **T1: 스레드 재구성 = 가중치 재적재** — `setNumThreads` 가 스레드를
  모두 부수며 평가기가 사라져 다음 탐색이 lz4 를 다시 푼다(1→2 851ms, 2→1 733ms). 노드마다의 원자 연산은 −1%(B1).

### 항목

| ID | 내용 | 상태 · 근거 |
|---|---|---|
| 2-a | relaxed SIMD 변형 | **채택** — +18~20%(B2), 결과 불변(§3 G0) |
| P1-1 | `thread_num` · `hash_size` 를 **예열 전에**(`bootCommands`) | **완료** — 첫 탐색 재적재 3줄 → 0줄 |
| P1-2 | 스레드 수 변경을 「적용」으로 확정 | **완료** — `planThreadChange` |
| P1-3 | 필승 국면 묶음 `mate-suite.json` 50 · 지표 「첫 필승 시간」 | **완료** — 하드 묶음 `mate-suite-hard.json` 40(32~60초 칸은 비었다) |
| P2-1 · P2-5 | codebook gather 파이프라이닝 · 출력 줄 단위화 | **불채택** — NPS 개선 없음 |
| P2-2 | 스레드 재구성 때 평가기 인계 | **채택** — 재적재 12 → 0줄. 게이트 `thread-reload-probe.mjs` |
| P2-3 · P2-4 | `alignas(64)` · TT 적중 쓰기 조건화 | **불채택**(S1, 물리 4코어) — 모든 효과 ±1% 안, 떼어 낼 폴스 셰어링이 거의 없었다 |
| P2-6 | `wasm-opt -O4 --converge`(2-i) | **채택** — single t1 +1.20% · +1.56%. 기능은 변형별로만 켠다 |
| P2-7 | 게으른 평가 여유 `margin_scale` | **불채택** — 싼 확인 관문 미달(네이티브) |
| P3-1 | 위협 수 축소 완화 | **불채택** — SPRT 782판 Elo −6.7(−21.8 ~ +8.4) |
| P3-3 | 정책 헤드 얕은 노드 생략 | **불채택** — SPRT H0 · Elo −19.4 |
| P3-4 | 2 스레드 깊이 분산 | **불채택** — 잡음 바닥 안 |
| P3-5 | WASM PGO | **불채택** — NPS 개선 없음(브랜치 `feature/p3-5-wasm-pgo` 에 남김) |
| P4-1 | 주기 노드 카운터(출력 전용) | **채택** — 격리 멀티의 NODE 멈춤 해소 |
| M1 | cachegrind 결정적 비용 지표 | **완료** — 같은 빌드 Ir 차 2×10⁻⁹ |
| M3 | 500ms 속도-Elo 환산 | **완료** — 속도 2배 = **+105.7 Elo**(+82.1 ~ +130.4) → **+1% ≈ +1.5 Elo**. 환산 = Elo(2배) × ln(1+p)/ln 2 |
| A1 | dwconv `mulhi` → `q15mulr` | **채택** — WASM SPRT H1 **Elo +20.2**(+6.6 ~ +33.9). 네이티브는 속도 이득 0이라 −8.8 — 앱(NEON) 이식은 ARM 측정 전까지 보류 |
| A2 | codebook 행 재배치 · 순서 정렬 | **기각** — M1: codebook 미스가 추정 사이클의 ~0.3% |
| A3 | `starBlock` 가중치 재사용 배치(relaxed 만) | **채택** — 같은 트리 +8.67%(+7.86 ~ +9.48), 재현 +11.15% |
| A4 | 정책 결과 캐시(스레드별 2^12 표, 결과 불변) | **채택** — 재사용 가능 29.4% · Ir/노드 −2.68% · 순서 회전 하네스로 **+5.01% · +5.46%**(A/A −0.12 · +0.04%). 앱 K3 로도 탑재 |
| N0 | 가중치 갱신 | **갱신 없음** — 배포 가중치가 공개된 최신(rapfi-networks `e32ad77a`) |
| N1 · N1b | 소형 값 헤드 증류 | **기각** — 보류 승률 차 p99 28.5%p(관문 5%p), float 512 폭 상한도 22.5%p: 싼 근사가 없다. N2 · N3 은 그래서 보류 |
| 1-e · 기타 | MCTS 전환, TT 32비트화 · 가상 호출 제거 · 스택 조정 | **기각** |

**판정 규칙.**
1. **결과 불변 변경**: BENCH 해시 · 노드가 같아야 하고, 1차 관문은 M1(결정적 Ir). M1 이 개선을 보이면 CI NPS 는 「악화 아님」만
   본다(±3~4% 순서 효과 안의 개선을 두 번 연속 요구하지 않는다). 대조는 같은 러너 · 같은 툴체인에서 A/B 를 함께 빌드하고
   (`bench-gomocalc.yml` 의 `patches` · `base_patches`), 두 번째 실행은 순서를 뒤집는다. **BENCH 의 nps 는 판정에 쓰지 않는다**.
2. **트리를 바꾸는 변경**: 주 지표는 **SPRT 하나**(`sprt.yml` · `bench/sprt/runner.mjs`, 네이티브가 2~4배 빠르다), 그리고 mate
   suite 의 첫 필승 시간 중앙값이 나빠지지 않을 것(`mate-suite.yml`). 주 지표는 착수 전에 적는다.
3. **CPU 의존 변경**(relaxed 등)은 Intel · AMD 각각에서. **SMP 판정은 물리 코어 러너에서만**(SMT 2 논리 러너는 기록만).
4. 양자화를 바꾸는 변경은 네이티브 · WASM · NEON 을 한 패치로 — SPRT 의 트리와 배포의 트리가 같아야 한다.
5. 관문을 못 넘으면 다음 단계(SPRT)를 돌리지 않는다. 로컬 Celeron 수치는 결론에 쓰지 않는다(잡음 ±30%).

**지표.** 결과 불변(`node spike/node-bench.mjs`) · NPS(국면 5 × 10초, 예열 뒤 기하 평균, `bench/gomocalc/run.mjs`) · 핫패스 ·
첫 필승 시간(`mate-probe.mjs`) · 기동(가중치 캐시 ~57ms · 예열 ~0.9s) · 재적재 · relaxed 건전성(`spike/relaxed-equivalence.mjs`) ·
강도(SPRT).

**빌드.** `-O3 -ffp-contract=off -fexceptions -flto -msimd128 [-mrelaxed-simd] [-pthread -sPROXY_TO_PTHREAD]`, 링크 `--closure=1
-sALLOW_MEMORY_GROWTH -sSTACK_SIZE=2MB`(`tools/build_engine_wasm.sh` → upstream CMake). 쓰이는 wasm 기능은 simd · sign-ext ·
nontrapping-float-to-int · reference-types · bulk-memory-opt(+멀티 threads · bulk-memory, +relaxed-simd) — 기능을 하나씩 끄고 쟀다.

**열린 일.** `EMSDK_VERSION=latest` 고정(릴리스 재현성) · 2-g 정렬 부분 선택 · 3-g `PTHREAD_POOL_SIZE` · M4 물리 코어 SMP 기준선
(1·2·4 스레드) → S4 기본 스레드 정책(지금 「자동」 = 코어 − 1, 최대 4) · S2 VCT 증명 보조 스레드(60~180초 하드 묶음부터) ·
A3 일반 변형 배치판 · SPRT 러너의 「판 가득」(렌주라면 패스로 비김 — 결과는 같다) · upstream BENCH 해시 이슈(§1 W0-3).

---

## §3. gomocalc 대조 (2026-09-29 탑재 비교 · 10-06 ~ 07 대국)

대상: [dhbloo/gomoku-calculator](https://github.com/dhbloo/gomoku-calculator)(a742d450)와 그 배포본(Rapfi 0.43.01).
하네스 `bench/gomocalc/`(원자료 `results/*.json`) · `bench/sprt/`.

| ID | 내용 | 결과 |
|---|---|---|
| G0 | 탑재 방식 · 속도 | 같은 국면 · 가중치에서 **NPS 는 사실상 같다**(96.5K ↔ 98.5K). 깊은 공통 깊이 도달은 우리가 빠르다(직접 개시 −63% 등). relaxed 빌드는 NPS +23% · BENCH 시간 −23.5% 이면서 **해시 · 노드가 비트 단위로 같다**(x86 두 기계 — 구현 정의라 다른 CPU 는 미확인). 냉 탐색(JIT 승격 전)은 첫 탐색이 **10~26% 느리다** + 가중치 적재 0.4~0.9초 → 선적재 · 예열(`engine-worker.ts`). wasm 은 같은 트리에서 네이티브 SSE 의 43%(relaxed 56%). 내려받기는 우리가 가볍다(.data 19.9 ↔ 40.3MB) |
| G1 | 대국 — 1 스레드 · 수당 500ms · 균형 개시 60 | **Elo +100.2(95% +76.3 ~ +124.9)**, 606판 · 361판에서 H1(Intel 8488C, run 37477685626). 같은 ISA 대조는 **+3.7(−27.4 ~ +34.9)** — 차이는 거의 전부 relaxed 변형(과 그 위의 A3)의 속도다: 대국 중 NPS ×1.635 의 M3 환산 몫 +75.0. AMD 7B13 에서 **+77.2**, 2 스레드 멀티 relaxed 끼리 **+34.4**(NPS ×1.260 의 몫 +35.2 와 같다). 2,578판 고장 0 |
| G1-r | relaxed 몫의 CPU 의존 | 같은 런 짝: Intel 8488C(VNNI) 전체 **+57.0%** · 균형 개시 +77.0% ↔ AMD 7B13 +32.5% · +42.8%(`variant-speed.yml`) — VNNI 가설과 정합, 인과 확정은 VNNI 만 다른 CPU 쌍이 필요 |

**한계.** 4 스레드 · 긴 시간 제어는 재지 않았다. 대조의 해상도는 ±31 Elo 라 「소스 · 패치 몫은 0」이 아니라 「±31 안」. G0 의 CI
러너는 논리 2개라 스레드 확장 절대값은 물리 4코어 이상에서 다시. 판 가득은 러너가 비김으로 친다.

**재현.** `gh workflow run match-gomocalc.yml -f test_variant=single-simd128-relaxed -f games=800` → `node bench/sprt/match-report.mjs
--games games.jsonl --summary summary.json --json showcase/src/data/match-relaxed.json` — 쇼케이스(`showcase/`)가 같은 숫자를 쓴다.

---

## §4. 보안 (2026-10-10, Phase 0 ~ 2)

**결론 한 줄: «숨기기»에 쓸 노력을 «지키기»로.** GPL-3.0 공개 저장소 · 정적 호스팅 · 온라인 대국 없음이라 난독화 · 데이터
암호화 · 안티 디버깅은 공격 비용을 올리지 못한다. 지킬 것은 조작된 기보 · 링크를 통한 스크립트 주입으로 IndexedDB(특히
**기기 밖으로 나가면 안 되는 RenjuNet 팩**)가 새는 것, 클릭재킹, 의존성 · CI 를 통한 공급망 변조다.

| ID | 결함 → 처리 |
|---|---|
| F1 | 리포트 HTML 의 `</script>` 탈출(`report.ts` `json()`) → `<` · U+2028 · U+2029 이스케이프, 회귀 시험 2건 |
| F2 | 프로덕션 소스맵 공개 → `sourcemap: "hidden"`, 배포에서 빼고 CI 아티팩트(90일)로만 · 「소스맵 게이트」 |
| F3 | 배포가 잠금 파일 무시(`--no-frozen-lockfile`) → 모든 워크플로 `--frozen-lockfile` |
| F4 | `wrangler@3` 주 버전만 고정 → `wrangler@3.114.17` |
| F5 | 액션 태그 고정 → `uses:` 전부 커밋 SHA + Dependabot(npm · actions 주 1회) |
| F6 | 헤더 없음 → Phase 1 |

**Phase 1 — 헤더.** 원본은 `public/_headers` 하나(`scripts/headers.ts` 가 읽어 개발 서버 · 미리보기 · 스모크 서버가 같은 헤더):
CSP `script-src 'self' 'wasm-unsafe-eval'` · `style-src 'self'` · `connect-src 'self'` · `frame-ancestors 'none'` 등, CORP · XFO ·
nosniff · Referrer-Policy · Permissions-Policy · HSTS. **CSP 는 `/*` 한 규칙에만** — 워커는 자기 응답의 CSP 를 따르고 WASM 컴파일이
엔진 워커 안에서 일어난다. 인라인 테마 스크립트는 `theme-init.js` 로 뺐다. 감시: 스모크의 `watchBrowser`(`csp-watch.ts`)가 페이지 ·
워커의 위반 하나면 실패, `headers.test.ts` 가 정책을 못 박고, `deploy.yml` 이 실제 응답의 헤더를 본다.

**Phase 2 — 공급망.** CODEOWNERS(워크플로 · `_headers` · `public/joseki/`) · 규칙 «main 보호 — 코드 소유자 검토»(관리자 우회) ·
`pnpm audit --prod --audit-level high` 차단 · 배포 · CI 는 GitHub 호스트 러너.

**결정.** 데이터 은폐는 목표가 아니다(오프닝 표는 공개 자료). 브라우저 하한 Chrome/Edge 97 · Firefox 102 · Safari 16
(`'wasm-unsafe-eval'` 의 하한).

**배운 것.** CSP 위반은 앱이 아니라 하네스에서 났다 — Playwright 의 문자열 `waitForFunction` 은 폴링마다 `eval` 한다(함수로 준다),
`innerHTML` 의 `style=` 속성. **Report-Only 에서는 워커 안 WASM 위반이 콘솔에 남지 않는다** — 강제 단계의 스모크가 최종 관문.
react-router 7 은 탐색을 `startTransition` 으로 감싸 URL 이 먼저 바뀐다 — 스모크는 URL 이 아니라 화면 요소를 기다린다.

**하지 않은 것.** Phase 3(선택) 오프닝 표 바이너리 패킹(비밀이 아니라 크기 · 속도 목적) · Trusted Types. Phase 4 — 코드 난독화 ·
안티 디버깅 · 개발자 도구 감지는 비권장.

---

## §5. 오프닝 협상과 엔진 지원 (W4, 2026-09-03)

**Rapfi 는 `yxswap2step<n>` · `yxsoosorvstep<n>`(Yixin 의 명령)을 구현하지 않고, GUI 모드에서는 모르는 명령을 오류 없이 삼킨다.**
그래서 **스왑2 · Soosorv-8 은 목록에서 내렸다** — 남은 개시는 자유 렌주 · RIF 오프닝 · 첫 수 이후 교환(협상 명령이 필요 없다).
화면이 이유를 말한다. 프로토콜 층(직렬화 · `MESSAGE SWAP2/SOOSORV` 파싱과 시험)은 남겨 두었다 — 엔진이 바뀌면 그대로 쓴다.

- 앱(Zenyth)에서 물려받은 맹점이었다 — 시험이 `FakeEngine` 으로 답을 만들어 넣어, **진짜 엔진을 붙인 스모크에서야** 드러났다.
- **감시견은 엔진 무응답 일반으로**(`gameStore.ts` `armWatchdog`): 답이 없으면 `YXSTOP` · 기다림을 풀고 알린다. 착수는 자기 예산
  + 10초, 협상이 돌아올 때를 위한 15초 바닥. 없을 때는 스왑2 가 판을 통째로 잠갔다.
- 보이지 않는 물음 상자가 판을 잠그던 것(개시 pane 안에 있어 자유 렌주에서 안 그려짐)도 함께 고쳤다.

---

## §6. 공식 정석 커리큘럼 (2026-10-11)

초보자가 전문가가 정한 오프닝 커리큘럼을 **읽기 전용으로** 받아 살펴보고, **직접 맞히며** 학습한다. 서버 · 계정 · DB 없음.

- **권한.** 경계는 git 이다. 설정의 «관리자 도구»는 편집 UI 를 보이게 할 뿐 비밀이 아니다 — 누구나 켜도 JSON 을 내려받는 것까지.
  배포본을 바꾸려면 저장소 쓰기 권한이 필요하고 `public/joseki/` 는 CODEOWNERS 검토 대상이다. 운영 절차는
  [`공식-정석-관리.md`](공식-정석-관리.md).
- **데이터.** `public/joseki/curriculum.json`(`format: "rapfiweb-curriculum"`, `schema: 1`) — 코스(`id` · 두 언어 제목 · 수준 · 요약
  · 레슨) → 레슨(`id` 는 파일 전체에서 유일 — 진도의 열쇠, `quiz.side`, 뿌리) → 마디(`move` · 두 언어 마크다운 해설 · 평가 기호 ·
  `role: "trap" | "refute"` · 자식). **내 정석 트리와 같은 모양**이라 그리기 · 덧그림을 그대로 쓰고 손실 없이 넘어간다.
  `children[0]` 이 추천 수, `!!` `!` `!?` 는 다른 좋은 수, `?!` `?` `??` 는 나쁜 수. 검증은 가져오기와 같은 규칙(`cleanTree`), 배포
  파일은 단위 시험이 매번 본다. 웹과 앱(Zenyth)이 **같은 파일**을 읽는다.
- **화면.** 체스닷컴 레슨의 세 층: 코스 목록 → 코스(`?course=`) → 레슨(`?lesson=` · `&mode=learn`, 판 왼쪽 · [살펴보기 | 학습] ·
  코치 말풍선 · 트리). 진도는 이 브라우저의 `rapfi.curriculum.progress`.
- **학습.** 학습자 차례에 추천 · 좋은 수 → ✓ 그 갈래로(상대의 주 변화는 자동), 알려진 나쁜 수 · 함정 → ✗ 해설과 응징 수(그 마디의
  `[0]`), 트리에 없는 수 → «정석 밖». 두 번 틀리면 힌트. 점수 = 첫 시도 정답 / 학습자 수. 판정은 순수 함수(`core/curriculum/quiz.ts`).
- **하지 않는 것.** 예시 코스는 규칙과 앱 분류기에서 나온 사실만 — 깊은 수순 · 형세 판단 같은 전문 해설은 관리자가 채운다.

---

## §7. 디자인 토큰 — 앱과 같은 값 (2026-09-02, 11-01 재정렬)

기준값 `src/core/design/tokens.golden.json` 은 앱 `Oklch.kt` 을 Java 로 전사한 `tools/tone-dump/ToneDump.java`(CI `tone-dump.yml`)가
굽는다 — Kotlin `Float` = Java `float`, `kotlin.math` 는 `java.lang.Math` 로 위임하므로. 전사의 근거는 `Color.kt` 가 못 박은
앵커 `Clay.tone(76) = #DAB673` 을 정확히 재현하는 것.

- **W1 의 1비트 어긋남은 Float/double 이 아니었다.** 이식본 `toHex` 가 버림을 썼는데, 실효 반올림은 Compose `Color(r,g,b)` 생성자가
  8비트로 패킹하며 일어난다(`+0.5f`). `Math.floor(v * 255 + 0.5)` 로 고친 뒤 전부 일치. 두 채널이 모두 같은 방향으로 1씩 어긋난
  것은 규칙 차이의 신호였다.
- **`Clay.tone(42)` 의 앵커 주석이 틀렸다**(`#7B5E22` → 실제 `#7E5D14`). 앱은 주석만 고쳤다 — 값을 바꾸면 배포된 앱의 격자색이 바뀐다.
- **14램프 · 1,414값**(2026-11-01): 앱 UI 개편 2차의 `Maple` · `Violet` · `Lilac` · `Mist` · `MistVariant` 추가와 `WoodNight` 82° → 70°.
  `ramps.test.ts` 가 매 CI **정확히** 대조한다(±1 허용 없음). 램프의 `hue` · `chroma` 를 고치면 `tone-dump.yml` 을 다시 돌린다.
- **역할 배정**은 `scheme.ts` = 앱 `Theme.kt` 그대로(§8 Z1):

| 역할 | 라이트 | 다크 | 검은 배경 |
|---|---|---|---|
| 페이지 `background` · `surface` | `Mist` 99 | `Mist` 10 | `Mist` 0 |
| 면 `surface-container`(= `--c-card`) | `Mist` 95 | `Mist` 18 | `Mist` 10 |
| `surface-container-low · high · highest` | `Mist` 96 · 92 · 90 | `Mist` 14 · 22 · 26 | 6 · 14 · 19 |
| `primary` / `on-primary` | `Violet` 40 / `Mist` 100 | `Violet` 80 / 20 | 그대로 |
| `secondary-container` / `on-…` | `Lilac` 90 / 20 | `Lilac` 30 / 92 | 그대로 |
| `on-surface` · `-variant` | `Mist` 10 · `MistVariant` 30 | `Mist` 92 · `MistVariant` 80 | 그대로 |
| `outline` · `outline-variant` | `MistVariant` 50 · 82 | `MistVariant` 60 · 30 | 그대로 |
| 판 나무 · 가장자리 · 격자 · 좌표 | `Maple` 76 · 70 · 40 · 30 | `WoodNight` 33 · 26 · 52 · 70 | 다크 그대로 |

  보드 화면만의 나무색 팔레트(`[data-wood]`, 앱 `WoodTheme`), 결과색 · 판 돌 · 의미색은 옛 램프 그대로. 시험: 대비 쌍 전부 AA
  (라이트 · 다크 · 검은 배경 · 나무 셋), 면/페이지 ≥ 1.06:1, `primary` ↔ 의미색 OKLab ≥ 0.08.

---

## §8. 앱 디자인 정렬 (Z0 ~ Z10, 2026-11-01 ~ 02)

웹을 2026-10-11 의 «먹과 한지»에서 **앱(Zenyth)의 지금 모습**으로. 옮긴 것은 앱의 코드(같은 저자)이고 Mornye(GPL-3.0)는 보지
않았다. 지금 디자인의 정본은 [`../.calm-design/DESIGN.md`](../.calm-design/DESIGN.md).

**경계 — 손대지 않은 것.** 엔진 · WASM · 워커 프로토콜, 판 좌표 매핑, IndexedDB 형식, 설정 키(`rapfi.*`), CSP · COEP, 램프 계산식.
**웹에서 뺀 것** 진동 · 발열 거버너 · 포그라운드 서비스 · 알림 단계. **웹에만 남긴 것** 레일의 연구 hover 서브메뉴 · 넓은 화면 2단 ·
키보드 조작. 앱 전용 기능(원격 엔진 · 스왑2 · 시계 · 데스크톱 설정 전 항목)은 들이지 않는다.

| ID | 결과 |
|---|---|
| Z0 | 스크린샷 골든(`scripts/shots.ts` · `screenshots.yml`, 러너 `ubuntu-24.04` 고정 — 로컬 글꼴 래스터가 달라 **CI 에서만 유효**), 14램프 골든(§7), 판 색 `Maple`(Q2) |
| Z1 | 역할 배정 = `Theme.kt`, 무테 면(모서리 20), 보라 강조, 검은 배경(`rapfi.amoled`) |
| Z2 | 글자 = `Type.kt`(본문 15, 페이지 제목 34 ExtraBold 접힘), 리듬 = `Tokens.kt`(여백 16 · 카드 사이 12 · 카드 안 20 · 행 64) |
| Z3 | 채운/외곽선 내비 + 알약, **고급 사용자 모드**(Q3 — 기본 5탭, DB 는 모드에서, 저장값은 옛 `showAdvanced` 그대로), 미끄러지는 세그먼트 |
| Z4 | 툴바 버튼 묶음(▶ 84×56), 요약 줄, 휴대폰 스냅 시트(Q4 — 640 미만), 나무색 팔레트, 값 글자 `textInkAt`, 국면 카드 파일 키 · 형세 그래프 · 물결 진행 · 미니 분석 바 |
| Z5 | 설정 = 목록 → 하위 화면(`/settings/<page>`) · 연결 그룹 · 체크 원 · 검색은 그 자리에서 바꾼다 |
| Z6 | 알약 단추 · 필터 칩(목록 거르기는 가로 한 줄) · 배지 · 아이콘 타일 · 이름 붙은 진행. `window.prompt` 넷 → `Sheet`, 묻는 것은 `ConfirmBox` |
| Z7 | 실전 대국 데이터 카드(오프닝 · 랭킹 맨 위) · «나중에» 배너 · 브라우저당 한 번 시트 · 랭킹 빈 칸 안내 |
| Z8 | «일식» 아이콘(파비콘 · 매니페스트 · `ZenythMark`, `scripts/gen-icons.ts`), 전에 온 사람의 «새로워진 점»(`RELEASE`, 설정 ▸ 정보에서도). 처음엔 앱처럼 첫 방문 환영 · 둘러보기도 옮겼으나 **2026-11-02 사용자 결정으로 웹에서 걷었다** — 처음 온 사람은 곧바로 보드이고 엔진도 바로 뜬다. 서비스 워커는 범위 밖 |
| Z9 | 앱의 네 스프링을 풀어 `linear()` 토큰으로(`springs.ts`), 판 밖만. 첫 등장 스태거 · 앞으로만 미끄러지는 진행 · 감속 모드면 모두 끔 |
| Z10 | 도메인 → **`zenythweb.pages.dev`**, README 그림(`tools/readme_assets.py`), `SECURITY.md`, `DESIGN.md` 다시 씀, 저장소 설정 |

**결정(사용자, 2026-11-01).** Q1 새 Pages 프로젝트 + 옛 주소 301 — 계획의 `zenyth.pages.dev` 는 다른 회사의 사이트라
`zenythweb`, 옛 주소의 브라우저 자료는 안내 기간 없이 바로(IndexedDB 는 출처에 묶인다). Q2 판 색 앱과 같게. Q3 고급 사용자 모드.
Q4 좁은 폭 시트. Q5 진동 없음(iOS 에 없다). Z6 부터 PR 마다 CI 녹색이면 병합.

**도메인 이전.** 새 주소의 배포 · 검증이 모두 끝난 뒤에만 `deploy.yml` 의 마지막 단계가 옛 `rapfiweb` 프로젝트를
`tools/redirect-rapfiweb/`(`/* → :splat 301`)로 덮는다 — 그 전에 새 주소가 정말 이 앱인지(`<title>`) 보고, 뒤에 국면 · 레슨 링크와
앱이 받는 `curriculum.json` 이 경로 · 질의 그대로 넘어가는지 본다. 새 프로젝트의 배포별 주소는 인증서가 몇 분 뒤에 서서 첫 검증이
TLS 에서 떨어졌다 → 「배포 주소가 설 때까지」 단계. 앱은 두 호스트를 다 받고, 이미 깔린 앱은 301 을 따라간다.

**저장소 보호.** `engine-*` 태그는 불변(옮기기 · 지우기 금지, 우회 없음 — `engine-release.yml` 이 있는 태그를 미리 거절).
«만들기는 관리자만»은 못 걸었다: 사용자 저장소의 규칙은 GitHub Actions 앱을 우회자로 둘 수 없다. 비공개 취약점 신고 켬.

**배운 것.**
- **pixelmatch 의 문턱 하나로는 색 변화와 지터를 가르지 못한다** — 채널 하나라도 2 넘게 움직인 픽셀만 다름으로 센다. 다시 기록할
  때는 의도한 장면만 커밋한다(`board-wide-dark` 의 2픽셀 지터는 늘 되돌렸다).
- **URL 이 아니라 그 화면을 기다린다.** 정석 스모크의 «학습 1수: start»(10월부터 가끔) — 탭이 `?mode=learn` 을 바꾸고 라우터가
  전환으로 그려, 학습 화면이 뜨기 전에 판을 눌렀다. 설정 하위 화면도 `data-page` 를 기다린다.
- `useLayoutEffect` 에서 뒤 형제의 ref 는 아직 없다 · 끌기 핸들러는 상태가 아니라 ref 를 읽는다 · `position: absolute` 의 sr-only
  는 기준 상자가 필요하다(페이지 스크롤이 생겼다).
- 첫 방문 판정은 «`rapfi.*` 가 하나도 없음»이라, 하네스가 먼저 심은 값 하나가 처음 온 사람을 전에 온 사람으로 바꾼다 — 첫 방문을
  보는 스모크(`?firstvisit`)에는 하네스가 아무 값도 심지 않는다.
- 이 기계에서 도구 호출 사이에 `.git/index.lock`(0바이트)이 남는 일이 잦았다 — git 프로세스가 없음을 확인하고 지운다.

**열린 일.** 서비스 워커(오프라인) · 웹의 «전체 백업 내보내기/가져오기»(출처를 옮길 때 자료를 데려갈 길) · 리뷰 진행 막대의 물결.
