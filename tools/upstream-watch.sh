#!/usr/bin/env bash
#
# Rapfi upstream 감시 — .github/workflows/upstream-watch.yml 이 매주 돌린다.
#
# 보는 것 두 가지:
#   1. 웹 엔진(WASM)이 고정한 upstream 커밋(tools/build_engine_wasm.sh 의 RAPFI_COMMIT)보다
#      upstream 기본 브랜치가 앞섰는가. 앞섰다면 배포 패치(engine-release.yml 의 RAPFI_PATCHES)가
#      그 최신 커밋 위에 차례로 얹히는지까지 시험한다 — 올리는 일의 크기를 미리 알 수 있게.
#   2. 데스크톱이 동봉하는 네이티브 엔진(desktop.yml 의 RAPFI_NATIVE_TAG)보다 새 공식 릴리스가 있는가.
#
# 하나라도 뒤처졌으면 «upstream-watch» 라벨 이슈 하나를 열거나 본문을 갱신하고(upstream 최신 커밋이
# 바뀌었을 때만 댓글로 알린다), 둘 다 최신이면 열린 이슈를 닫는다. 엔진을 실제로 올리지는 않는다 —
# 패치를 다시 맞추고 기준선을 새로 재는 일은 사람이 판단한다(docs/engineering-notes.md §11).
#
# upstream 은 저장소 **번호**로 찾는다. dhbloo/rapfi 가 dotb1ue/rapfi 로 이름이 바뀐 적이 있다(2026-10).
# 필요: gh(GH_TOKEN), git, jq — GitHub 호스트 러너에는 모두 있다.
set -eu

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM_REPO_ID=170808684
LABEL="upstream-watch"
WORK="${WORK:-$(mktemp -d)}"
DRY_RUN="${DRY_RUN:-}"  # 1 이면 이슈를 건드리지 않고 본문만 찍는다

pin_of () { sed -n "s/^$1=\"\${$1:-\([0-9a-f]*\)}\"/\1/p" "$ROOT/tools/build_engine_wasm.sh"; }
RAPFI_PIN="$(pin_of RAPFI_COMMIT)"
NETWORKS_PIN="$(pin_of NETWORKS_COMMIT)"
PATCHES="$(sed -n 's/^ *RAPFI_PATCHES: "\(.*\)"$/\1/p' "$ROOT/.github/workflows/engine-release.yml")"
NATIVE_TAG="$(sed -n 's/^ *RAPFI_NATIVE_TAG: "\(.*\)"$/\1/p' "$ROOT/.github/workflows/desktop.yml")"
for v in RAPFI_PIN NETWORKS_PIN PATCHES NATIVE_TAG; do
  [ -n "${!v}" ] || { echo "::error::$v 를 저장소에서 읽지 못했습니다 — 파일 형식이 바뀌었는지 확인하세요"; exit 1; }
done

REPO="$(gh api "repositories/$UPSTREAM_REPO_ID" -q .full_name)"
BRANCH="$(gh api "repos/$REPO" -q .default_branch)"
HEAD_SHA="$(gh api "repos/$REPO/commits/$BRANCH" -q .sha)"
COMPARE="$(gh api "repos/$REPO/compare/$RAPFI_PIN...$HEAD_SHA")"
AHEAD="$(jq -r .ahead_by <<< "$COMPARE")"
BEHIND="$(jq -r .behind_by <<< "$COMPARE")"
LATEST_TAG="$(gh api "repos/$REPO/releases/latest" -q .tag_name 2> /dev/null || echo "")"
echo "upstream $REPO@$BRANCH ${HEAD_SHA:0:8} — 고정 ${RAPFI_PIN:0:8} 보다 $AHEAD 앞섬 · $BEHIND 뒤짐"
echo "네이티브: 동봉 $NATIVE_TAG · 최신 릴리스 ${LATEST_TAG:-없음}"

WEB_STALE=0
[ "$AHEAD" -gt 0 ] && WEB_STALE=1
NATIVE_STALE=0
[ -n "$LATEST_TAG" ] && [ "$LATEST_TAG" != "$NATIVE_TAG" ] && NATIVE_STALE=1

BODY="$WORK/issue.md"
{
  echo "<!-- upstream-watch head:$HEAD_SHA native:$LATEST_TAG -->"
  echo "이 이슈는 [\`upstream-watch\`](${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-lowqen/Zenyth-web}/blob/main/.github/workflows/upstream-watch.yml) 가 매주 갱신합니다."
  echo "둘 다 최신이 되면 저절로 닫힙니다. 마지막 확인: $(date -u +%Y-%m-%dT%H:%MZ)"
  echo
  echo "## 웹 엔진 (WASM)"
  echo
  echo "| | 커밋 |"
  echo "|---|---|"
  echo "| 고정 (\`tools/build_engine_wasm.sh\`) | [\`${RAPFI_PIN:0:8}\`](https://github.com/$REPO/commit/$RAPFI_PIN) |"
  echo "| upstream \`$BRANCH\` 최신 | [\`${HEAD_SHA:0:8}\`](https://github.com/$REPO/commit/$HEAD_SHA) |"
  echo
  if [ "$WEB_STALE" -eq 0 ]; then
    echo "최신입니다."
  else
    echo "**$AHEAD 커밋 앞섬** — [비교](https://github.com/$REPO/compare/${RAPFI_PIN:0:8}...${HEAD_SHA:0:8})"
    [ "$BEHIND" -gt 0 ] && echo "(고정 커밋이 upstream 기본 브랜치에 없는 커밋을 $BEHIND 개 갖고 있습니다 — 강제 푸시 등)"
    echo
    echo "<details><summary>커밋 목록(최근 30개)</summary>"
    echo
    jq -r '.commits | reverse | .[:30][] | "- `\(.sha[0:8])` \(.commit.committer.date[0:10]) \(.commit.message | split("\n")[0])"' <<< "$COMPARE"
    echo
    echo "</details>"
    echo

    # 실제로 받아서 Networks 와 패치 적용을 본다. 패치는 빌드와 같은 순서로 차례로 얹는다.
    git -C "$WORK" clone -q --filter=blob:none "https://github.com/$REPO.git" rapfi
    git -C "$WORK/rapfi" -c advice.detachedHead=false checkout -q "$HEAD_SHA"
    NET_HEAD="$(git -C "$WORK/rapfi" ls-tree HEAD Networks | awk '{print $3}')"
    echo "### 가중치 (Networks 서브모듈)"
    echo
    if [ "$NET_HEAD" = "$NETWORKS_PIN" ]; then
      echo "그대로입니다 (\`${NETWORKS_PIN:0:8}\`)."
    else
      echo "**바뀜**: \`${NETWORKS_PIN:0:8}\` → [\`${NET_HEAD:0:8}\`](https://github.com/dhbloo/rapfi-networks/compare/${NETWORKS_PIN:0:8}...${NET_HEAD:0:8})"
      echo "— \`rapfi.data\` 가 바뀔 수 있습니다. 렌주 전용 프리로드(\`build_engine_wasm.sh\` [2.5/6])가 그대로 맞는지 확인하세요."
    fi
    echo
    echo "### 배포 패치 적용 시험 (upstream 최신 위에 차례로)"
    echo
    stopped=""
    for p in $PATCHES; do
      name="$(basename "$p")"
      if [ -n "$stopped" ]; then
        echo "- ⏭ \`$name\` (앞 패치에서 멈춤)"
      elif git -C "$WORK/rapfi" apply --check "$ROOT/$p" 2> /dev/null; then
        git -C "$WORK/rapfi" apply "$ROOT/$p"
        echo "- ✅ \`$name\`"
      else
        stopped=1
        files="$(git -C "$WORK/rapfi" apply --check "$ROOT/$p" 2>&1 | sed -n 's/^error: patch failed: \([^:]*\):.*/\1/p' | sort -u | tr '\n' ' ')"
        echo "- ❌ \`$name\` — 손으로 옮겨야 합니다${files:+: \`$files\`}"
      fi
    done
    echo
    echo "### 올리는 순서"
    echo
    echo "1. \`tools/patches/\` 의 배포 패치를 새 커밋 위로 다시 맞춘다(옛 커밋 위에 커밋으로 쌓고 rebase → 커밋마다 \`git diff\` 로 다시 뽑기)."
    echo "2. \`RAPFI_COMMIT\` · \`NETWORKS_COMMIT\`(\`tools/build_engine_wasm.sh\` · \`build_host_engine.sh\`)과 워크플로의 \`rapfi-<커밋>-v1\` 캐시 키를 바꾼다."
    echo "3. \`spike/web-baseline.json\` 의 \`single-simd128\` 기준선을 비우고, \`engine-release\` 를 새 태그(\`engine-<커밋8>-<꼬리>\`)로 실행한다."
    echo "4. 그 런의 BENCH 해시를 기준선에 적고, 릴리스의 \`.js\`/\`.wasm\`/\`engine-manifest.json\`/\`ENGINE_VERSION.txt\` 를 커밋하고, \`web.yml\` · \`deploy.yml\` · \`bench/gomocalc/fetch-engines.mjs\` 의 \`ENGINE_TAG\` 를 바꾼다."
  fi
  echo
  echo "## 데스크톱 동봉 엔진 (네이티브)"
  echo
  if [ "$NATIVE_STALE" -eq 0 ]; then
    echo "최신 공식 릴리스(\`${LATEST_TAG:-없음}\`)를 동봉하고 있습니다."
  else
    echo "동봉 \`$NATIVE_TAG\` → **새 릴리스 [\`$LATEST_TAG\`](https://github.com/$REPO/releases/tag/$LATEST_TAG)**"
    echo
    echo "\`desktop.yml\` 의 \`RAPFI_NATIVE_TAG\` · \`RAPFI_NATIVE_SHA256\`(릴리스 자산 digest)과 \`src/features/settings/AboutPanel.tsx\` 의 \`RAPFI_NATIVE_TAG\` 를 함께 바꿉니다(\`tauri-config.test.ts\` 가 대조)."
  fi
} > "$BODY"

cat "$BODY"
[ -n "$DRY_RUN" ] && { echo "(DRY_RUN — 이슈는 건드리지 않음)"; exit 0; }

gh label create "$LABEL" --color "c5def5" --description "Rapfi upstream 감시(자동)" > /dev/null 2>&1 || true
ISSUE="$(gh issue list --label "$LABEL" --state open --limit 1 --json number -q '.[0].number // empty')"

if [ "$WEB_STALE" -eq 0 ] && [ "$NATIVE_STALE" -eq 0 ]; then
  if [ -n "$ISSUE" ]; then
    gh issue comment "$ISSUE" --body "웹 엔진과 데스크톱 엔진 모두 upstream 최신입니다 — 닫습니다."
    gh issue close "$ISSUE"
  fi
  exit 0
fi

TITLE="Rapfi upstream:"
[ "$WEB_STALE" -eq 1 ] && TITLE="$TITLE 웹 엔진이 $AHEAD 커밋 뒤처짐"
[ "$WEB_STALE" -eq 1 ] && [ "$NATIVE_STALE" -eq 1 ] && TITLE="$TITLE ·"
[ "$NATIVE_STALE" -eq 1 ] && TITLE="$TITLE 새 릴리스 $LATEST_TAG"

if [ -z "$ISSUE" ]; then
  gh issue create --title "$TITLE" --label "$LABEL" --body-file "$BODY"
else
  PREV="$(gh issue view "$ISSUE" --json body -q .body | sed -n 's/.*<!-- upstream-watch head:\([0-9a-f]*\) native:\([^ ]*\) -->.*/\1 \2/p' | head -1)"
  gh issue edit "$ISSUE" --title "$TITLE" --body-file "$BODY"
  # 같은 상태로 매주 댓글이 쌓이지 않게 — upstream 이 움직였을 때만 알린다(댓글이 알림을 보낸다).
  if [ "$PREV" != "$HEAD_SHA $LATEST_TAG" ]; then
    gh issue comment "$ISSUE" --body "upstream 이 움직였습니다: \`${HEAD_SHA:0:8}\` · 최신 릴리스 \`${LATEST_TAG:-없음}\` — 본문을 갱신했습니다."
  fi
fi
