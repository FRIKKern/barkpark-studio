#!/usr/bin/env bash
# housekeeping.yml's `push` job runs this file from main's checkout (no credentials kept); the job and this
# file are pinned in scripts/lib/keyed-jobs.json, and scripts/lib/housekeeping-push.test.mjs runs these same
# bytes. It trusts nothing from `refresh` but the picture's bytes: one plain file, an SVG, which it commits
# as docs/images/roadmap.svg on main as main is now, with nothing else changed. A push rejected because
# main moved meanwhile starts over from the new main, at most 3 times; the work tree is never touched.
# docs/decisions/0003-tracking-and-hygiene.md
set -euo pipefail
svg="$RUNNER_TEMP/roadmap/roadmap.svg"
path=docs/images/roadmap.svg
# An error line; % CR LF escaped as GitHub reads them.
fail() {
  local m=${1//'%'/%25}
  m=${m//$'\r'/%0D}
  printf '::error::%s\n' "${m//$'\n'/%0A}"
  exit 1
}
# The deploy key, from this step's env only: out of every child's env, written to a file just for each push
# (after every check on the picture), and that file removed after the push or when this script ends.
key=${HOUSEKEEPING_DEPLOY_KEY:-}
unset HOUSEKEEPING_DEPLOY_KEY
keyfile="$RUNNER_TEMP/housekeeping-deploy-key"
trap 'rm -f "$keyfile" "$keyfile.hosts" "$RUNNER_TEMP/housekeeping-index"' EXIT
push() { # <commit>: main moves to it only as a fast-forward
  [ -n "$key" ] || fail 'no deploy key'
  (umask 077 && printf '%s\n' "$key" > "$keyfile")
  printf '%s\n' 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' > "$keyfile.hosts"
  local ok=0
  GIT_SSH_COMMAND="ssh -F /dev/null -i $keyfile -o IdentitiesOnly=yes -o UserKnownHostsFile=$keyfile.hosts -o StrictHostKeyChecking=yes" \
    git push -q "${HOUSEKEEPING_PUSH_URL:-git@github.com:$GH_REPO.git}" "$1:refs/heads/main" || ok=$?
  rm -f "$keyfile" "$keyfile.hosts"
  return "$ok"
}

# The picture: a plain file (no link), under 1 MB, that opens as an SVG.
{ [ -f "$svg" ] && [ ! -L "$svg" ]; } || fail 'no roadmap.svg from refresh'
[ "$(wc -c < "$svg")" -lt 1048576 ] || fail 'roadmap.svg is 1 MB or more'
[[ $(head -c 512 "$svg") == *'<svg'* ]] || fail 'roadmap.svg is not an SVG'
blob=$(git hash-object -w -- "$svg")

for try in 1 2 3; do
  git fetch -q origin +refs/heads/main:refs/remotes/origin/main
  main=$(git rev-parse origin/main)
  # main's tree with the one file swapped, built in an index of its own.
  export GIT_INDEX_FILE="$RUNNER_TEMP/housekeeping-index"
  git read-tree "$main"
  git update-index --add --cacheinfo "100644,$blob,$path"
  tree=$(git write-tree)
  unset GIT_INDEX_FILE
  [ "$tree" != "$(git rev-parse "$main^{tree}")" ] || { echo 'no change'; exit 0; }
  commit=$(git -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
    commit-tree "$tree" -p "$main" -m 'chore: refresh roadmap [skip ci]')
  push "$commit" && exit 0
  echo "::warning::push $try rejected (main moved): committing on the new main"
  sleep "$try"
done
fail 'main kept moving; 3 pushes rejected'
