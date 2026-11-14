# public/engine/

Rapfi WebAssembly 산출물 — **네 변형**이 같은 빌드(릴리스 `engine-1387d113-a6`)에서 나온다.

`engine-1387d113-a6` 은 패치 묶음은 `a6` 그대로(11개)이고 바탕 upstream 을 `3c94c2a9` → `1387d113`(0.44.1 이후, dotb1ue/rapfi)으로,
가중치(Networks)를 `e32ad77a` → `7eeb19b5` 로 올린 판이다(docs/engineering-notes.md §11). 탐색이 달라진다 — 규칙별 탐색 파라미터 ·
규칙별 classical 값 · upstream 의 탐색 · 프로토콜 수정. mix9svq 가중치는 그대로이고 classical 모델 파일이 새 형식이라 `.data` 가 달라졌다.
DB 패치 다섯은 upstream 의 DB 수정과 겹쳐 새 커밋에 맞춰 다시 썼다(패스 칸으로 끝나는 키를 이제 바르게 읽는다).

아래는 옛 바탕(`3c94c2a9`) 위에서 패치를 하나씩 얹어 온 기록이다.

`a6` 은 `a5` 에 DB 패치 둘을 얹었다(탐색 불변, 가중치 · Emscripten 6.0.13 그대로 — docs/engineering-notes.md §10).
`tools/patches/db5-compact-record-table.patch` 는 yixindb 기록을 메모리에서 압축 기록 표로 들고(적재 · 메모리 약 1/3),
`db6-differential-save-journal.patch` 는 렌주 설정의 `journal = true` 로 바뀐 기록만 `rapfi.db.journal` 에 덧붙인다 —
워커는 본 파일이 그대로면 저널만 IndexedDB 로 옮긴다(A7, `src/features/database/dbStore.ts`). `.data` 가 a5 와 다른 건 이 설정 한 줄 때문.

`a5` 는 `a4` 에 DB 저장 패치 셋을 얹었다(탐색 불변, 가중치 · Emscripten 6.0.13 그대로 — docs/engineering-notes.md §9).
`tools/patches/db1-atomic-nonblocking-save.patch` 는 yixindb 저장을 `<path>.tmp` 에 쓴 뒤 rename 으로 바꿔 넣고
저장이 탐색을 멈추지 않게, `db2-usedatabase-guard.patch` 는 `INFO USEDATABASE 1` 이 붙은 DB 를 다시 읽지 않게,
`db4-async-save.patch` 는 네이티브 멀티스레드 빌드에서 저장을 백그라운드로 돌린다(Emscripten 에서는 꺼짐).
MEMFS 에는 하드 링크가 없어 db1 의 백업은 복사로 물러선다.

`a4` 는 `w8` 에 `tools/patches/a4-policy-cache.patch` 를 얹었다 — 같은 국면의 정책 출력을 스레드별
2^12 표로 재사용한다(결과 불변, 스레드마다 ~3.9MB). BENCH 는 `w8` 과 같고, 같은 트리 속도는 relaxed 에서
+5.0 ~ +5.5%(docs/engineering-notes.md §2 A4). `w8` 은 `a3` 에 `tools/patches/w8-export-fs.patch` 를
얹어 글루가 Emscripten `FS` 를 내보내게(`EXPORTED_RUNTIME_METHODS` 에 `'FS'`) 한 판이다 — 엔진 DB 파일
`rapfi.db` 를 워커가 메모리 FS 로 넣고 꺼낸다(W8, `src/features/database/`).

```
rapfi-multi-simd128-relaxed.js/.wasm   멀티스레드 + relaxed SIMD — 격리 + relaxed 를 아는 브라우저(Chromium 114+)에서 먼저
rapfi-multi-simd128.js/.wasm           멀티스레드 — 격리된 환경
rapfi-single-simd128-relaxed.js/.wasm  단일 스레드 + relaxed SIMD — 격리가 안 될 때
rapfi-single-simd128.js/.wasm          단일 스레드 — 마지막 물러설 곳(SIMD 만 있으면 된다)
rapfi.data                  ~20 MB     ← 커밋하지 않는다(릴리스 자산). **모든 변형이 함께 쓴다.** 렌주 가중치만
engine-manifest.json                   ← 릴리스 자산. 같은 내용이 src/engine/engine-manifest.json 으로 커밋된다
ENGINE_VERSION.txt                     빌드 기록(업스트림 커밋·Emscripten 판·가중치 해시)
package.json                           { "type": "commonjs" } (upstream 글루는 CJS)
```

`.js` 와 `.wasm` 은 커밋한다(앱이 `libengine.so` 를 커밋한 이유와 같다 — 클론 직후
바로 실행). **모두 같은 빌드의 짝이어야 한다** — 글루(.js)에 데이터 패키지 목록(가중치
파일별 위치)이 박혀 있어, 다른 빌드의 `.data` 와 섞이면 가중치를 엉뚱하게 잘라 읽는다.
빌드 스크립트가 네 글루의 목록과 변형별 `.data` 가 모두 같음을 확인한 뒤 `rapfi.data`
하나로 낸다. 새 릴리스를 내면 여기의 `.js`/`.wasm` 여덟 개와
`src/engine/engine-manifest.json` 을 함께 바꾼다. CI·배포는 릴리스에서 받은 뒤
`scripts/verify-engine.ts` 로 그 짝을 검증한다(`web.yml`·`deploy.yml`).

## 가중치는 앱이 받는다

글루가 `.data` 를 스스로 받지 않는다. 엔진 워커가 기동하자마자 `rapfi.data?v=<해시>` 를
**Cache Storage 에서 꺼내거나 내려받아 SHA-256 을 확인하고**, 글루에
`getPreloadedPackage` 로 넘긴다(`src/engine/weights-cache.ts`). 그래서

- 재방문·엔진 전환(멀티 → 단일 폴백)에 20MB 를 다시 받지 않는다
- 해시가 매니페스트와 다르면(새 버전·손상) 지우고 다시 받고, 새로 받은 것도 틀리면 뜨지 않는다

## 어느 변형이 뜨는가

앱이 정한다(`src/engine/engine-client.ts` `detectCapabilities` · `planVariants`):
**relaxed 멀티 → 멀티 → relaxed 단일 → 단일** 순으로 띄워 보고, 기동 핸드셰이크나 **예열
탐색**에서 실패하면 다음으로 물러선다. relaxed 명령은 명세상 구현 정의라, 릴리스 게이트가
러너에서 relaxed 의 BENCH 해시 = 일반 SIMD 해시를 확인한다(`engine-release.yml`).
`?relaxed=0` 으로 relaxed 를 끌 수 있다(진단용).

멀티 변형의 엔진 스레드는 엔진 워커 번들을 다시 여는데, 그때 글루를 이 폴더에서 찾는다
(`engine-worker.ts` 「pthread 가드」 — relaxed 멀티는 제 번들 `engine-worker-relaxed.ts`) —
엔진 경로를 바꾸면 `VITE_ENGINE_BASE_URL` 도 함께 바꾼다.

엔진은 **자동으로 뜨지 않는다** — 20MB 가중치를 아무도 요청하지 않았는데 받아 오지 않기
위해서다. 가중치 선적재와 예열은 사용자가 엔진을 띄운 **그 기동 안에서** 돈다.
