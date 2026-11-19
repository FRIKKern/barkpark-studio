# shellcheck shell=bash
# Sourced by scripts/sync-act.sh and scripts/housekeeping-push.sh, the two scripts that push with the
# housekeeping deploy key; it is pinned with each of their jobs in scripts/lib/keyed-jobs.json.
# The key comes from the step's env (DEPLOY_KEY) and leaves it here, so no child process sees it. It is a
# file only inside deploy_push, removed after the push, and by the trap if the script ends mid-push.
# docs/decisions/0010-deploy-key-one-helper.md

# An error line; % CR LF escaped as GitHub reads them, so a value never starts a line of its own.
fail() {
  local m=${1//'%'/%25}
  m=${m//$'\r'/%0D}
  printf '::error::%s\n' "${m//$'\n'/%0A}"
  exit 1
}

deploy_key=${DEPLOY_KEY:-}
unset DEPLOY_KEY
deploy_keyfile="$RUNNER_TEMP/deploy-key"
trap 'rm -f "$deploy_keyfile" "$deploy_keyfile.hosts"' EXIT

# deploy_push <refspec> [git push option...]: one push to this repo over SSH with the key, GitHub's host
# key pinned; its exit status is the push's.
deploy_push() {
  [ -n "$deploy_key" ] || fail 'no deploy key'
  (umask 077 && printf '%s\n' "$deploy_key" > "$deploy_keyfile")
  printf '%s\n' 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' > "$deploy_keyfile.hosts"
  local status=0
  GIT_SSH_COMMAND="ssh -F /dev/null -i $deploy_keyfile -o IdentitiesOnly=yes -o UserKnownHostsFile=$deploy_keyfile.hosts -o StrictHostKeyChecking=yes" \
    git push -q "${@:2}" "${DEPLOY_PUSH_URL:-git@github.com:$GH_REPO.git}" "$1" || status=$?
  rm -f "$deploy_keyfile" "$deploy_keyfile.hosts"
  return "$status"
}
