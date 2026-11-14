# P3-5 WASM PGO — 불채택 실험 보관

`feature/p3-5-wasm-pgo` 브랜치의 커밋 10개를 `git format-patch` 로 보관한 것이다(2026-11-14 브랜치 정리).
결론은 docs/engineering-notes.md §2 P3-5 — **NPS 개선 없음, 불채택.**

바탕 커밋은 `52a919f`(upstream 3c94c2a9 시절)다. 되살리려면:

```bash
git switch -c p3-5-wasm-pgo 52a919f
git am tools/archive/p3-5-wasm-pgo/*.patch
```
