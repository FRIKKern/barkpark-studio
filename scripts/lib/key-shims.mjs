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
