#!/usr/bin/env bash
# sync-pack.yml's `act` job runs this file from main's checkout (no credentials kept); the job and this
# file are pinned in scripts/lib/keyed-jobs.json, and scripts/lib/sync-act.test.mjs runs these same bytes.
# It trusts nothing from the plan job except which of the three actions to take (each re-checked against
# GitHub's own state), the studio's report file (conformance/barkpark-studio.json) and SOURCE.md's prose.
# It finds the sync PR itself; checks the bundle, the commit's parent and both sides of every changed path;
# checks that every other pack file is Barkpark's own, byte for byte, at the commit SOURCE.md names, on
# Barkpark's main and not older than main's; and writes the commit message, PR title and body itself.
# docs/decisions/0009-pack-syncs-itself.md
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
# The deploy key, from this step's env only: out of every child's env, written to a file just for each push
# (after every check on the bundle), and that file removed after the push or when this script ends.
key=${SYNC_DEPLOY_KEY:-}
unset SYNC_DEPLOY_KEY
keyfile="$RUNNER_TEMP/sync-deploy-key"
trap 'rm -f "$keyfile" "$keyfile.hosts"' EXIT
push() { # <lease> <refspec>
  [ -n "$key" ] || fail 'no deploy key'
  (umask 077 && printf '%s\n' "$key" > "$keyfile")
  printf '%s\n' 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' > "$keyfile.hosts"
  GIT_SSH_COMMAND="ssh -F /dev/null -i $keyfile -o IdentitiesOnly=yes -o UserKnownHostsFile=$keyfile.hosts -o StrictHostKeyChecking=yes" \
    git push -q --force-with-lease="$1" "${SYNC_PUSH_URL:-git@github.com:$GH_REPO.git}" "$2"
  rm -f "$keyfile" "$keyfile.hosts"
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
    # Only while the PR's head holds main's pack, byte for byte. The branch stays: it may carry a hand
    # commit (accepted rows) worth keeping.
    git fetch -q origin "+refs/heads/main:refs/sync-pack/main" "+refs/heads/$branch:refs/sync-pack/head" || fail "#$number's head cannot be fetched"
    git diff --quiet refs/sync-pack/main refs/sync-pack/head -- conformance/pack || fail "#$number's pack differs from main's: not closed"
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
    # and not older than the one main's SOURCE.md names (commits and trees only, no file contents fetched).
    # conformance.mjs and its types sit in Barkpark's conformance/.
    re_source='commit `([0-9a-f]{40})`'
    [[ $(git cat-file blob "$new:conformance/pack/SOURCE.md") =~ $re_source ]] || fail 'SOURCE.md names no Barkpark commit'
    at=${BASH_REMATCH[1]}
    bp="$RUNNER_TEMP/barkpark.git"
    git init -q --bare "$bp"
    git -C "$bp" remote add origin "$barkpark"
    git -C "$bp" config remote.origin.promisor true
    git -C "$bp" config remote.origin.partialclonefilter blob:none
    git -C "$bp" fetch -q --filter=blob:none origin main
    git -C "$bp" merge-base --is-ancestor "$at" FETCH_HEAD || fail "Barkpark $at is not on Barkpark's main"
    if [[ $(git cat-file blob origin/main:conformance/pack/SOURCE.md 2>/dev/null || true) =~ $re_source ]]; then
      was=${BASH_REMATCH[1]}
      git -C "$bp" merge-base --is-ancestor "$was" "$at" || fail "Barkpark $at is older than $was, which main holds"
    fi
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
    # The words are act's own: the plan's commit message is dropped, its tree and parent kept.
    title="PortableDoc pack: sync from Barkpark ${at:0:12}"
    body="$RUNNER_TEMP/sync-body.md"
    printf '%s\n' "Written by \`scripts/pack-sync.mjs\` from [\`FRIKKern/barkpark\` ${at:0:12}](https://github.com/FRIKKern/barkpark/commit/$at) \`api/priv/portable_doc\`, and checked by \`scripts/sync-act.sh\`: every pack file but \`SOURCE.md\` is Barkpark's own at that commit. Barkpark is the source: fix the pack there, never here." \
      '' "If \`unit\` fails here, conformance rows moved: the studio renderer is behind Barkpark. Fix the renderer, or accept the rows on this branch (\`pnpm --dir app conformance:write\`) and say why. The run summary of the sync job lists the rows." > "$body"
    sync=$(git commit-tree "$new^{tree}" -p "$base" -m "$title")
    push "$branch:$lease" "$sync:refs/heads/$branch"
    if [ -n "$number" ]; then
      gh pr edit "$number" --title "$title" --body-file "$body"
    else
      gh pr create --head "$branch" --base main --title "$title" --body-file "$body" ||
        fail 'The sync PR cannot be opened. Settings > Actions > General > "Allow GitHub Actions to create and approve pull requests" must be on.'
      # A PR the workflow token opens starts no checks; a push by the deploy key does.
      start=$(git commit-tree "$sync^{tree}" -p "$sync" -m 'Start the checks')
      push "$branch:$sync" "$start:refs/heads/$branch"
    fi
    ;;
  *) fail "unknown action $action" ;;
esac
