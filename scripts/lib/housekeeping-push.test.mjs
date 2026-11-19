// housekeeping.yml's push job runs scripts/housekeeping-push.sh; here the same file runs with bash against a
// local bare repo as origin. The picture is made by hand, as a hostile refresh job could make it.
import assert from 'node:assert/strict'
import {execFileSync, spawnSync} from 'node:child_process'
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test, {after} from 'node:test'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const PUSH = join(root, 'scripts/housekeeping-push.sh')
const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], {encoding: 'utf8'}).trim()
const SVG = 'docs/images/roadmap.svg'
const made = []
const tmp = (prefix) => (made.push(mkdtempSync(join(tmpdir(), prefix))), made.at(-1))
after(() => made.forEach((d) => rmSync(d, {recursive: true, force: true})))

const env = {...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}
const git = (cwd, ...args) => execFileSync('git', args, {cwd, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']}).trim()
const write = (dir, path, text) => (mkdirSync(join(dir, path, '..'), {recursive: true}), writeFileSync(join(dir, path), text))

/** An origin whose main holds the picture and an app file, and a work clone on main. */
function world() {
  const base = tmp('hk-')
  git(base, 'init', '-q', '--bare', '-b', 'main', 'origin.git')
  const work = join(base, 'work')
  git(base, 'clone', '-q', 'origin.git', 'work')
  write(work, SVG, '<svg>old</svg>\n')
  write(work, 'app/x.ts', 'x\n')
  git(work, 'add', '-A')
  git(work, 'commit', '-q', '-m', 'main')
  git(work, 'push', '-q', 'origin', 'HEAD:main')
  return {base, work, origin: join(base, 'origin.git'), main: git(work, 'rev-parse', 'HEAD')}
}
const mainAt = (w) => git(w.base, 'ls-remote', w.origin, 'refs/heads/main').split('\t')[0]

/**
 * The script in a fresh clone of origin (the job's checkout), `picture(dir)` writing refresh's artifact.
 * Origin's pre-receive hook logs the key file as each push sees it; `first` (shell, in origin) runs just
 * before the first push. `keyWhile`: each git command run while the key file exists; `keyLeft`: key files left in RUNNER_TEMP.
 */
function run(w, picture, {first = '', key = 'the deploy key'} = {}) {
  const bin = tmp('bin-')
  const temp = tmp('temp-')
  mkdirSync(join(temp, 'roadmap'))
  picture(join(temp, 'roadmap'))
  const pushed = join(bin, 'pushed-key.log')
  const once = join(bin, 'hook-ran')
  writeFileSync(join(w.origin, 'hooks/pre-receive'), `#!/bin/sh\ncat "${temp}/housekeeping-deploy-key" >> "${pushed}" 2>/dev/null || echo none >> "${pushed}"\n`)
  chmodSync(join(w.origin, 'hooks/pre-receive'), 0o755)
  const keyWhile = join(bin, 'key-while.log')
  writeFileSync(join(bin, 'first.sh'), `cd "${w.origin}"\n${first}\n`)
  const firstPush = `[ "$1" != push ] || [ -e "${once}" ] || { touch "${once}"; PATH="${process.env.PATH}" sh "${join(bin, 'first.sh')}"; }`
  writeFileSync(join(bin, 'git'), `#!/bin/sh\n[ ! -e "$RUNNER_TEMP/housekeeping-deploy-key" ] || echo "$1" >> "${keyWhile}"\n${firstPush}\nexec "${REAL_GIT}" "$@"\n`)
  chmodSync(join(bin, 'git'), 0o755)
  const checkout = join(tmp('checkout-'), 'repo')
  git(w.base, 'clone', '-q', w.origin, checkout)
  const r = spawnSync('bash', [PUSH], {cwd: checkout, encoding: 'utf8', env: {...env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: temp, HOUSEKEEPING_DEPLOY_KEY: key, HOUSEKEEPING_PUSH_URL: w.origin}})
  const lines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n') : [])
  return {
    status: r.status,
    err: r.stdout + r.stderr,
    keyWhile: lines(keyWhile).filter((c) => c !== 'receive-pack'),
    pushedWith: lines(pushed),
    keyLeft: readdirSync(temp).filter((f) => f.startsWith('housekeeping-')),
    worktree: git(checkout, 'status', '--porcelain'),
  }
}
const svg = (text) => (dir) => writeFileSync(join(dir, 'roadmap.svg'), text)

test('housekeeping push: one commit on main, the picture only; the key a file only while git pushes', () => {
  const w = world()
  const r = run(w, svg('<svg>new</svg>\n'))
  assert.equal(r.status, 0, r.err)
  const at = mainAt(w)
  git(w.work, 'fetch', '-q', 'origin', 'main')
  assert.equal(git(w.work, 'rev-parse', `${at}^`), w.main)
  assert.equal(git(w.work, 'diff', '--name-only', w.main, at), SVG)
  assert.equal(git(w.work, 'show', `${at}:${SVG}`), '<svg>new</svg>')
  assert.equal(git(w.work, 'log', '-1', '--format=%s %an', at), 'chore: refresh roadmap [skip ci] t')
  assert.deepEqual(r.pushedWith, ['the deploy key'])
  assert.deepEqual(r.keyWhile, ['push'], 'the key file exists only while git pushes')
  assert.deepEqual([r.keyLeft, r.worktree], [[], ''], 'no key file or index left; the work tree untouched')
})

test('housekeeping push: main moves during the push; the commit is made again on the new main', () => {
  const w = world()
  // Just before the first push, main moves (a merge lands), so that push is refused.
  const first = 'git update-ref refs/heads/main "$(git commit-tree main^{tree} -p main -m landed)"'
  const r = run(w, svg('<svg>new</svg>\n'), {first})
  assert.equal(r.status, 0, r.err)
  assert.match(r.err, /push 1 rejected \(main moved\)/)
  const at = mainAt(w)
  git(w.work, 'fetch', '-q', 'origin', 'main')
  assert.equal(git(w.work, 'log', '-1', '--format=%s', `${at}^`), 'landed')
  assert.equal(git(w.work, 'diff', '--name-only', `${at}^`, at), SVG)
  // git refuses the first push itself (not a fast-forward); the second reaches origin with the key.
  assert.deepEqual(r.pushedWith, ['the deploy key'])
  assert.deepEqual(r.keyWhile, ['push', 'push'])
  assert.deepEqual(r.keyLeft, [])
})

test('housekeeping push: no change, or a picture refused, pushes nothing and never writes the key', () => {
  const w = world()
  const quiet = (name, picture, needle, status = 1) => {
    const r = run(w, picture)
    assert.equal(r.status, status, `${name}: ${r.err}`)
    assert.match(r.err, needle, name)
    assert.equal(mainAt(w), w.main, `${name}: main as it was`)
    assert.deepEqual([r.keyWhile, r.pushedWith, r.keyLeft], [[], [], []], `${name}: the key never written`)
  }
  quiet('the same picture', svg('<svg>old</svg>\n'), /^no change$/m, 0)
  quiet('no picture', () => {}, /no roadmap\.svg from refresh/)
  quiet('a link to another file', (dir) => symlinkSync('/etc/hosts', join(dir, 'roadmap.svg')), /no roadmap\.svg from refresh/)
  quiet('not an SVG', svg('#!/bin/sh\n'), /roadmap\.svg is not an SVG/)
  quiet('1 MB or more', svg(`<svg>${'x'.repeat(1 << 20)}</svg>`), /1 MB or more/)
  // No key: refused at the push, with nothing pushed.
  const r = run(w, svg('<svg>new</svg>\n'), {key: ''})
  assert.equal(r.status, 1, r.err)
  assert.match(r.err, /^::error::no deploy key$/m)
  assert.equal(mainAt(w), w.main)
})
