// scripts/lib/deploy-push.sh, the one place the deploy key is handled (sourced by sync-act.sh and
// housekeeping-push.sh): a small script sources these same bytes and pushes to a local bare origin.
import assert from 'node:assert/strict'
import {execFileSync, spawnSync} from 'node:child_process'
import {chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test, {after} from 'node:test'
import {fileURLToPath} from 'node:url'

const HELPER = fileURLToPath(new URL('./deploy-push.sh', import.meta.url))
const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], {encoding: 'utf8'}).trim()
const base = mkdtempSync(join(tmpdir(), 'deploy-push-'))
after(() => rmSync(base, {recursive: true, force: true}))

const env = {...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}
const git = (cwd, ...args) => execFileSync('git', args, {cwd, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']}).trim()
const origin = join(base, 'origin.git')
const work = join(base, 'work')
const temp = join(base, 'temp')
const bin = join(base, 'bin')
for (const d of [temp, bin]) execFileSync('mkdir', ['-p', d])
git(base, 'init', '-q', '--bare', '-b', 'main', 'origin.git')
git(base, 'clone', '-q', 'origin.git', 'work')
const empty = execFileSync('git', ['mktree'], {cwd: work, env, input: '', encoding: 'utf8'}).trim()
const commit = (msg, parent) => git(work, 'commit-tree', empty, ...(parent ? ['-p', parent] : []), '-m', msg)
const first = commit('first')
git(work, 'push', '-q', 'origin', `${first}:refs/heads/main`)
const mainAt = () => git(base, 'ls-remote', origin, 'refs/heads/main').split('\t')[0]

// Origin logs the key file as a push sees it; git logs each command run while the key file exists, and
// with KILL_AT_PUSH set, a push ends the script (SIGTERM) while it runs.
const pushed = join(bin, 'pushed.log')
const keyWhile = join(bin, 'key-while.log')
writeFileSync(join(origin, 'hooks/pre-receive'), `#!/bin/sh\ncat "${temp}/deploy-key" >> "${pushed}" 2>/dev/null || echo none >> "${pushed}"\n`)
writeFileSync(join(bin, 'git'), `#!/bin/sh\n[ ! -e "${temp}/deploy-key" ] || echo "$1" >> "${keyWhile}"\n[ "$1" != push ] || [ -z "$KILL_AT_PUSH" ] || { kill -TERM $PPID; exit 1; }\nexec "${REAL_GIT}" "$@"\n`)
chmodSync(join(origin, 'hooks/pre-receive'), 0o755)
chmodSync(join(bin, 'git'), 0o755)
// A script as the two callers are: source the helper, run git and a child before and after one push.
const script = join(bin, 'caller.sh')
writeFileSync(script, `set -euo pipefail\n. "${HELPER}"\ngit status -s\nsh -c 'echo "child sees \${DEPLOY_KEY:-no key}"'\ndeploy_push "$@" || echo "push status $?"\ngit status -s\necho done\n`)

/** The caller run with `args` for deploy_push; `more` adds to its env. */
function run(args, more = {}) {
  for (const f of [pushed, keyWhile]) rmSync(f, {force: true})
  const r = spawnSync('bash', [script, ...args], {cwd: work, encoding: 'utf8', env: {...env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: temp, DEPLOY_KEY: 'the deploy key', DEPLOY_PUSH_URL: origin, ...more}})
  const lines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n') : [])
  return {status: r.status, out: r.stdout + r.stderr, pushedWith: lines(pushed), keyWhile: lines(keyWhile).filter((c) => c !== 'receive-pack'), keyLeft: readdirSync(temp)}
}

test('deploy_push: the key is a file only while git pushes, and no child process sees it', () => {
  const next = commit('next', first)
  const r = run([`${next}:refs/heads/main`])
  assert.equal(r.status, 0, r.out)
  assert.equal(mainAt(), next)
  assert.match(r.out, /^child sees no key$/m)
  assert.match(r.out, /^done$/m)
  assert.deepEqual(r.pushedWith, ['the deploy key'])
  assert.deepEqual(r.keyWhile, ['push'], 'not written before the push, removed after it')
  assert.deepEqual(r.keyLeft, [])
})

test('deploy_push: never forced; a lease it is given holds; the trap removes the key if the script ends mid-push', () => {
  const at = mainAt()
  const side = commit('side', first)
  const plain = run([`${side}:refs/heads/main`])
  assert.match(plain.out, /^push status 1$/m, 'not a fast-forward: refused')
  const stale = run([`${side}:refs/heads/main`, `--force-with-lease=main:${first}`])
  assert.match(stale.out, /^push status 1$/m, 'a stale lease: refused')
  assert.equal(mainAt(), at)
  for (const r of [plain, stale]) assert.deepEqual([r.keyWhile, r.keyLeft], [['push'], []])
  const leased = run([`${side}:refs/heads/main`, `--force-with-lease=main:${at}`])
  assert.equal(mainAt(), side, leased.out)
  // Ended while the push runs: the trap removes the key file.
  const killed = run([`${first}:refs/heads/x`], {KILL_AT_PUSH: '1'})
  assert.notEqual(killed.status, 0, killed.out)
  assert.doesNotMatch(killed.out, /^done$/m)
  assert.deepEqual(killed.keyLeft, [])
  // No key: refused before any file is written.
  const none = run([`${first}:refs/heads/x`], {DEPLOY_KEY: ''})
  assert.equal(none.status, 1)
  assert.match(none.out, /^::error::no deploy key$/m)
  assert.deepEqual([none.pushedWith, none.keyWhile, none.keyLeft], [[], [], []])
})
