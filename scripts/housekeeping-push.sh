#!/usr/bin/env bash
# housekeeping.yml's `push` job runs this file from main's checkout (no credentials kept); the job and this
# file are pinned in scripts/lib/keyed-jobs.json, and scripts/lib/housekeeping-push.test.mjs runs these same
# bytes. It trusts nothing from `refresh` but the picture's bytes: one plain file, a checked SVG, which it commits
# as docs/images/roadmap.svg on main as main is now, with nothing else changed. A push rejected because
# main moved meanwhile is made again on the new main at once, at most 3 times; the work tree is never touched.
# docs/decisions/0003-tracking-and-hygiene.md
set -euo pipefail
svg="$RUNNER_TEMP/roadmap/roadmap.svg"
path=docs/images/roadmap.svg
# fail, and deploy_push: the one place the deploy key is handled (a file only while the push runs, after
# every check on the picture).
# shellcheck source=scripts/lib/deploy-push.sh
# (Its path by parameter expansion, a builtin: nothing forks while DEPLOY_KEY is still in the env.)
. "${BASH_SOURCE[0]%/*}/lib/deploy-push.sh"

# The picture: a plain file (no link), under 1 MB, that scripts/lib/svg-check.py passes (an SVG that holds
# nothing that runs or loads; Python's standard library only, isolated from the env).
{ [ -f "$svg" ] && [ ! -L "$svg" ]; } || fail 'no roadmap.svg from refresh'
[ "$(wc -c < "$svg")" -lt 1048576 ] || fail 'roadmap.svg is 1 MB or more'
why=$(python3 -I "${BASH_SOURCE[0]%/*}/lib/svg-check.py" "$svg") || fail "roadmap.svg refused: it $why"
blob=$(git hash-object -w -- "$svg")

for try in 1 2 3; do
  git fetch -q origin +refs/heads/main:refs/remotes/origin/main
  main=$(git rev-parse origin/main)
  # main's tree with the one file swapped, built in an index of its own.
  export GIT_INDEX_FILE="$RUNNER_TEMP/housekeeping-index"
  git read-tree "$main"
  git update-index --add --cacheinfo "100644,$blob,$path"
  tree=$(git write-tree)
  rm -f "$GIT_INDEX_FILE"
  unset GIT_INDEX_FILE
  [ "$tree" != "$(git rev-parse "$main^{tree}")" ] || { echo 'no change'; exit 0; }
  commit=$(git -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
    commit-tree "$tree" -p "$main" -m 'chore: refresh roadmap [skip ci]')
  err="$RUNNER_TEMP/push.err"
  if deploy_push "$commit:refs/heads/main" 2> "$err"; then rm -f "$err"; exit 0; fi
  cat "$err" >&2
  said=$(grep -m 1 -E '^( ! |error: |fatal: )' "$err" || true)
  rm -f "$err"
  # Again only when main moved; any other refusal (the key, the network) ends the run.
  git fetch -q origin +refs/heads/main:refs/remotes/origin/main
  [ "$(git rev-parse origin/main)" != "$main" ] || fail "push $try rejected, and main did not move: ${said:-git gave no reason}"
  echo "::warning::push $try rejected (main moved: ${said:-git gave no reason}); committing on the new main"
done
fail 'main kept moving; 3 pushes rejected'
