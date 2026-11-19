#!/usr/bin/env bash
# sync-pack.yml's `act` job runs this file from main's checkout, with the deploy key; the job and this
# file are pinned in scripts/lib/keyed-jobs.json, and scripts/lib/sync-act.test.mjs runs these same bytes.
# It trusts nothing from the plan job except the studio's own report file (conformance/barkpark-studio.json)
# and SOURCE.md's text: it finds the sync PR itself, checks the bundle, the commit's parent and both sides
# of every changed path, and that every other pack file is Barkpark's own, byte for byte, at the commit
# SOURCE.md names, a commit on Barkpark's main. docs/decisions/0009-pack-syncs-itself.md
set -euo pipefail
plan="$RUNNER_TEMP/plan"
barkpark="${BARKPARK_GIT:-https://github.com/FRIKKern/barkpark}"
branch=sync/barkpark-pack
new=refs/sync-pack/new
re_sha='^[0-9a-f]{40}$'
# An error line; % CR LF escaped as GitHub reads them, so a plan value never starts a line of its own.
fail() {
  local m=${1//'%'/%25}
  m=${m//$'\r'/%0D}
  printf '::error::%s\n' "${m//$'\n'/%0A}"
  exit 1
}

action=$(jq -r .action "$plan/plan.json")
# The sync PR, found here: this repo's (not a fork's) open PR from sync/barkpark-pack into main.
number=$(gh pr list --head "$branch" --base main --state open --json number,headRefName,baseRefName,isCrossRepository |
  jq -r --arg b "$branch" '[.[] | select((.isCrossRepository | not) and .headRefName == $b and .baseRefName == "main") | .number] | if length > 1 then "many" else (.[0] // "" | tostring) end')
[ "$number" != many ] || fail 'more than one sync PR is open'
asked=$(jq -r '.number // "" | tostring' "$plan/plan.json")
[ "$asked" = "$number" ] || fail "the plan names #$asked; the sync PR is #${number:-none}"

case "$action" in
  close)
    [ -n "$number" ] || { echo 'no sync PR open: nothing to close'; exit 0; }
    # The branch stays: it may carry a hand commit (accepted rows) worth keeping.
    gh pr close "$number" --comment 'main already carries these files: nothing left to sync.'
    ;;
  land)
    [ -n "$number" ] || { echo 'no sync PR open: nothing to land'; exit 0; }
    head=$(jq -r .head "$plan/plan.json")
    [[ $head =~ $re_sha ]] || fail "head $head"
    for wait in 5 10 15 20 25; do
      gh pr merge "$number" --squash --delete-branch --match-head-commit "$head" || true
      if [ "$(gh pr view "$number" --json state --jq .state)" = MERGED ]; then echo 'merged=true' >> "$GITHUB_OUTPUT"; exit 0; fi
      sleep "$wait"
    done
    fail "#$number is not merged after 5 tries"
    ;;
  push)
    git config user.name 'github-actions[bot]'
    git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
    main=$(jq -r .main "$plan/plan.json")
    [[ $main =~ $re_sha ]] || fail "main $main"
    git fetch -q origin main
    git merge-base --is-ancestor "$main" origin/main || fail "$main is not on main"
    lease=$(git ls-remote origin "refs/heads/$branch")
    lease=${lease%%[[:space:]]*}
    [ -z "$lease" ] || git fetch -q origin "$branch"
    { [ -f "$plan/sync.bundle" ] && git bundle verify -q "$plan/sync.bundle"; } || fail 'no valid sync.bundle'
    git fetch -q "$plan/sync.bundle" "HEAD:$new"
    [ "$(git cat-file -t "$new")" = commit ] || fail 'the bundle holds no commit'
    # One commit. With the sync PR open: on its current head with that main merged in (git redoes the
    # merge to check it; none when the head holds that main), so a hand commit there stays.
    # Without: straight on that main.
    read -r _ base extra <<<"$(git rev-list --parents -n 1 "$new")"
    if [ -z "$base" ] || [ -n "$extra" ]; then fail 'the sync commit is a merge'; fi
    if [ -n "$number" ]; then
      read -r _ ours theirs more <<<"$(git rev-list --parents -n 1 "$base")"
      if [ "$base" = "$lease" ] && git merge-base --is-ancestor "$main" "$lease"; then
        : # the PR's head already holds that main
      elif ! { [ "$ours" = "$lease" ] && [ "$theirs" = "$main" ] && [ -z "$more" ] && [ "$(git merge-tree --write-tree "$lease" "$main")" = "$(git rev-parse "$base^{tree}")" ]; }; then
        fail "the sync commit is not on #$number's head merged with main"
      fi
    else
      [ "$base" = "$main" ] || fail 'the sync commit is not on main'
    fi
    # Every changed path, renames as a delete and an add, so both sides are seen: under the pack or its
    # report, a plain file (100644) before and after, named in [A-Za-z0-9._/-], no . or .. segment.
    re_path='^(conformance/pack/[A-Za-z0-9._-][A-Za-z0-9._/-]*|conformance/barkpark-studio\.json)$'
    re_dot='(^|/)\.\.?(/|$)'
    re_mode='^(100644|000000)$'
    bad=''
    while IFS= read -r -d '' meta && IFS= read -r -d '' path; do
      read -r old mode _ _ status <<<"${meta#:}"
      [[ $old =~ $re_mode && $mode =~ $re_mode && $path =~ $re_path && ! $path =~ $re_dot ]] || bad+="$status $old $mode $path; "
    done < <(git diff --no-renames --raw -z "$base" "$new")
    [ -z "$bad" ] || fail "the sync commit changes what the pack never holds: $bad"
    # Every pack file but SOURCE.md: Barkpark's own blob at the commit SOURCE.md names, on Barkpark's main
    # (trees only, no file contents fetched). conformance.mjs and its types sit in Barkpark's conformance/.
    re_source='commit `([0-9a-f]{40})`'
    [[ $(git cat-file blob "$new:conformance/pack/SOURCE.md") =~ $re_source ]] || fail 'SOURCE.md names no Barkpark commit'
    at=${BASH_REMATCH[1]}
    bp="$RUNNER_TEMP/barkpark.git"
    git init -q --bare "$bp"
    git -C "$bp" remote add origin "$barkpark"
    git -C "$bp" config remote.origin.promisor true
    git -C "$bp" config remote.origin.partialclonefilter blob:none
    git -C "$bp" fetch -q --filter=blob:none --depth=200 origin main
    git -C "$bp" merge-base --is-ancestor "$at" FETCH_HEAD || fail "Barkpark $at is not on Barkpark's main"
    while IFS= read -r -d '' entry; do
      oid=${entry%%$'\t'*}
      oid=${oid##* }
      rel=${entry#*$'\t'conformance/pack/}
      case $rel in
        SOURCE.md) continue ;;
        conformance.mjs | conformance.d.mts) src=conformance/$rel ;;
        *) src=$rel ;;
      esac
      [ "$(git -C "$bp" rev-parse -q --verify "$at:api/priv/portable_doc/$src" || true)" = "$oid" ] || bad+="$rel; "
    done < <(git ls-tree -r -z "$new" -- conformance/pack/)
    [ -z "$bad" ] || fail "the pack differs from Barkpark $at: $bad"
    git push -q --force-with-lease="$branch:$lease" origin "$new:refs/heads/$branch"
    read -r title < "$plan/title.txt"
    if [ -n "$number" ]; then
      gh pr edit "$number" --title "$title" --body-file "$plan/body.md"
    else
      gh pr create --head "$branch" --base main --title "$title" --body-file "$plan/body.md" ||
        fail 'The sync PR cannot be opened. Settings > Actions > General > "Allow GitHub Actions to create and approve pull requests" must be on.'
      # A PR the workflow token opens starts no checks; a push by the deploy key does.
      start=$(git commit-tree "$new^{tree}" -p "$new" -m 'Start the checks')
      git push -q --force-with-lease="$branch:$(git rev-parse "$new")" origin "$start:refs/heads/$branch"
    fi
    ;;
  *) fail "unknown action $action" ;;
esac
