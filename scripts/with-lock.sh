#!/bin/sh
# Run a command under the machine-wide lock scripts/ci-local.mjs takes: one full
# suite / @evidence / audit run per machine (they share CPU and datasets; results
# from a loaded machine are not trusted). Single-spec runs don't need it.
#   scripts/with-lock.sh node e2e/run.mjs evidence
# BP_LOCK names another lock (e2e/run.mjs: the reference Sanity's one shared dataset).
LOCK=${BP_LOCK:-/tmp/barkpark-studio-ci-local.lock}
while ! mkdir "$LOCK" 2>/dev/null; do
  pid=$(tr -cd 0-9 < "$LOCK/pid" 2>/dev/null)
  if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then rm -rf "$LOCK"; continue; fi
  echo "with-lock: waiting for run $pid…" >&2
  sleep 15
done
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT INT TERM
"$@"
