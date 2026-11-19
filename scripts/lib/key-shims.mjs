// Test support for the scripts that push with the deploy key (docs/decisions/0010-deploy-key-one-helper.md):
// a PATH of shims only. Every external command a script starts must be one of these (any other is "not
// found" and fails the run), and each shim logs its name if the key's text is anywhere in its env.
import {execFileSync} from 'node:child_process'
import {chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

/** Every external command the two scripts, the helper, git's own children and the test hooks start. */
export const COMMANDS = ['awk', 'basename', 'bash', 'cat', 'chmod', 'cut', 'dirname', 'env', 'grep', 'head', 'jq', 'ls', 'mkdir', 'python3', 'rm', 'sed', 'sh', 'sleep', 'ssh', 'touch', 'tr', 'wc']

const real = (name) => execFileSync('sh', ['-c', `command -v ${name}`], {encoding: 'utf8'}).trim()

/** The real bash, to start a script with: a shim would rightly see the key in the script's own env. */
export const BASH = real('bash')

/**
 * Shims for COMMANDS in `dir`, each checking its own env for `key`. Returns the shim folder, `check(name)`
 * (the same check as a shell line, for a test's own wrapper or stub) and `seen()`, which returns (and
 * clears) the commands that saw the key.
 */
export function keyShims(dir, key) {
  mkdirSync(dir, {recursive: true})
  const log = join(dir, '..', `${dir.split('/').pop()}-seen.log`)
  // `export -p` is the shell's own list of its env (a builtin, in a subshell: the check runs no other program).
  const check = (name) => `case "$(export -p)" in *'${key}'*) echo "${name}" >> "${log}" ;; esac`
  for (const name of COMMANDS) {
    writeFileSync(join(dir, name), `#!/bin/sh\n${check(name)}\nexec "${real(name)}" "$@"\n`)
    chmodSync(join(dir, name), 0o755)
  }
  const seen = () => {
    const out = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []
    rmSync(log, {force: true})
    return out
  }
  return {dir, check, seen}
}

/**
 * The lines of a keyed script before the one that sources scripts/lib/deploy-push.sh that are not on the
 * short list of what may stand there. Until that line DEPLOY_KEY is still in the env, so nothing may start a
 * process: only comments and blank lines, `set -euo pipefail` as spelled, and an assignment to a lowercase
 * name (so never PATH, PS4, IFS or BASH_ENV) of a literal, single-quoted or of [A-Za-z0-9_./:-] alone. No
 * line may end in a backslash, which would join the next line to it.
 */
export function beforeTheHelper(text) {
  const lines = text.split('\n')
  const at = lines.indexOf('. "${BASH_SOURCE[0]%/*}/lib/deploy-push.sh"')
  if (at < 0) return ['no line sources lib/deploy-push.sh']
  const allowed = (l) =>
    !/\\$/.test(l) && (/^\s*(#.*)?$/.test(l) || l === 'set -euo pipefail' || /^[a-z_][a-z0-9_]*=('[^']*'|[A-Za-z0-9_./:-]*)$/.test(l))
  return lines.slice(0, at).filter((l) => !allowed(l))
}

/** Lines a test adds after `set -euo pipefail` that beforeTheHelper must name: [added, named (default: added)]. */
export const PRELUDE_BREAKS = [
  ...['x=$(/bin/date)', 'x=$(command -p date)', 'x=`date`', 'x="$(date)"', 'date', 'x=1 date', 'read -r x < <(date)', 'x=1; date', 'x=$(<f)'].map((l) => [l]),
  ['x=\\\n# date', 'x=\\'],
  ["PS4='$(date)'\nset -x"],
  ["y='a[$(date)]'\nx=${!y}", 'x=${!y}'],
  ['PATH=/tmp'],
  ['set -a'],
  ['set -e'],
  ['x="$RUNNER_TEMP/a"'],
  ['x=${y:-a}'],
]
