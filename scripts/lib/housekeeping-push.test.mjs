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
const CHECK = join(root, 'scripts/lib/svg-check.py')
/** A picture as the generator writes it, holding `text`. */
const pic = (text) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><text>${text}</text></svg>\n`
const made = []
const tmp = (prefix) => (made.push(mkdtempSync(join(tmpdir(), prefix))), made.at(-1))
after(() => made.forEach((d) => rmSync(d, {recursive: true, force: true})))

const env = {...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}
const git = (cwd, ...args) => execFileSync('git', args, {cwd, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']}).trim()
const write = (dir, path, text) => (mkdirSync(join(dir, path, '..'), {recursive: true}), writeFileSync(join(dir, path), text))

/** An origin whose main holds the picture and an app file, and the job's checkout of it; shared by the tests. */
function world() {
  const base = tmp('hk-')
  git(base, 'init', '-q', '--bare', '-b', 'main', 'origin.git')
  const work = join(base, 'work')
  git(base, 'clone', '-q', 'origin.git', 'work')
  write(work, SVG, pic('old'))
  write(work, 'app/x.ts', 'x\n')
  git(work, 'add', '-A')
  git(work, 'commit', '-q', '-m', 'main')
  git(work, 'push', '-q', 'origin', 'HEAD:main')
  // The script never touches the work tree or main's checkout, so one checkout serves every run.
  git(base, 'clone', '-q', 'origin.git', 'checkout')
  return {base, origin: join(base, 'origin.git'), checkout: join(base, 'checkout'), main: git(work, 'rev-parse', 'HEAD')}
}
const mainAt = (w) => git(w.origin, 'rev-parse', 'main')
/** A commit on origin: `parent subject author` and the paths it changes. */
const shown = (w, at) => `${git(w.origin, 'show', '--no-patch', '--format=%P %s %an', at)}\n${git(w.origin, 'diff-tree', '--no-commit-id', '--name-only', '-r', at)}`.trim()

/**
 * The script in the job's checkout of origin, `picture(dir)` writing refresh's artifact.
 * Origin's pre-receive hook logs the key file as each push sees it; `first` (shell, in origin) runs just
 * before the first push. `keyWhile`: each git command run while the key file exists; `keyLeft`: key files left in RUNNER_TEMP.
 */
function run(w, picture, {first = '', key = 'the deploy key', refuse = false} = {}) {
  const bin = tmp('bin-')
  const temp = tmp('temp-')
  mkdirSync(join(temp, 'roadmap'))
  picture(join(temp, 'roadmap'))
  const pushed = join(bin, 'pushed-key.log')
  const once = join(bin, 'hook-ran')
  writeFileSync(join(w.origin, 'hooks/pre-receive'), `#!/bin/sh\ncat "${temp}/deploy-key" >> "${pushed}" 2>/dev/null || echo none >> "${pushed}"\n${refuse ? 'exit 1\n' : ''}`)
  chmodSync(join(w.origin, 'hooks/pre-receive'), 0o755)
  const keyWhile = join(bin, 'key-while.log')
  writeFileSync(join(bin, 'first.sh'), `cd "${w.origin}"\n${first}\n`)
  const firstPush = `[ "$1" != push ] || [ -e "${once}" ] || { touch "${once}"; PATH="${process.env.PATH}" sh "${join(bin, 'first.sh')}"; }`
  writeFileSync(join(bin, 'git'), `#!/bin/sh\n[ ! -e "$RUNNER_TEMP/deploy-key" ] || echo "$1" >> "${keyWhile}"\n${firstPush}\nexec "${REAL_GIT}" "$@"\n`)
  chmodSync(join(bin, 'git'), 0o755)
  const r = spawnSync('bash', [PUSH], {cwd: w.checkout, encoding: 'utf8', env: {...env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: temp, DEPLOY_KEY: key, DEPLOY_PUSH_URL: w.origin}})
  const lines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n') : [])
  return {
    status: r.status,
    err: r.stdout + r.stderr,
    keyWhile: lines(keyWhile).filter((c) => c !== 'receive-pack'),
    pushedWith: lines(pushed),
    keyLeft: readdirSync(temp).filter((f) => f !== 'roadmap'),
    worktree: git(w.checkout, 'status', '--porcelain'),
  }
}
const svg = (text) => (dir) => writeFileSync(join(dir, 'roadmap.svg'), text)
const w = world()

test('housekeeping-push.sh handles no key itself: it sources scripts/lib/deploy-push.sh and pushes with deploy_push', () => {
  const code = readFileSync(PUSH, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l))
  assert.deepEqual(code.filter((l) => /deploy-push\.sh/.test(l)), ['. "$(dirname "${BASH_SOURCE[0]}")/lib/deploy-push.sh"'])
  assert.deepEqual(code.filter((l) => /deploy_push/.test(l)), ['  if deploy_push "$commit:refs/heads/main" 2> "$err"; then rm -f "$err"; exit 0; fi'])
  assert.deepEqual(code.filter((l) => /DEPLOY_|deploy_key|keyfile/.test(l) || /ssh|git push|\btrap\b/i.test(l)), [], 'nothing else touches the key')
})

test('housekeeping push: no change, or a picture refused, pushes nothing and never writes the key', () => {
  const quiet = (name, picture, needle, status = 1) => {
    const r = run(w, picture)
    assert.equal(r.status, status, `${name}: ${r.err}`)
    assert.match(r.err, needle, name)
    assert.equal(mainAt(w), w.main, `${name}: main as it was`)
    assert.deepEqual([r.keyWhile, r.pushedWith, r.keyLeft], [[], [], []], `${name}: the key never written`)
  }
  quiet('the same picture', svg(pic('old')), /^no change$/m, 0)
  quiet('no picture', () => {}, /no roadmap\.svg from refresh/)
  quiet('a link to another file', (dir) => symlinkSync('/etc/hosts', join(dir, 'roadmap.svg')), /no roadmap\.svg from refresh/)
  quiet('a shell script naming <svg', svg('#!/bin/sh\n# <svg\n'), /^::error::roadmap\.svg refused: it does not start with <svg/m)
  quiet('1 MB or more', svg(pic('x'.repeat(1 << 20))), /1 MB or more/)
})

test('svg-check.py: today\'s roadmap passes; one row per refusal', () => {
  // Every row in one python3 -I, the file's own check() on each (as hex), its verdict per line.
  const checkAll = (rows) => {
    const driver = `import importlib.util, sys\nspec = importlib.util.spec_from_file_location('c', sys.argv[1])\nc = importlib.util.module_from_spec(spec)\nspec.loader.exec_module(c)\nfor h in sys.stdin.read().split():\n    try:\n        c.check(bytes.fromhex(h))\n        print('ok')\n    except c.Refused as e:\n        print(str(e).replace('\\n', ' '))\n`
    const r = spawnSync('python3', ['-I', '-c', driver, CHECK], {input: rows.map((b) => Buffer.from(b).toString('hex')).join('\n'), encoding: 'utf8'})
    assert.equal(r.status, 0, r.stderr)
    return r.stdout.trim().split('\n')
  }
  // The generator writes its one <style> from scripts/lib/roadmap-style.css; the picture on main holds it.
  const today = readFileSync(join(root, SVG), 'utf8')
  assert.ok(today.includes(`<style>${readFileSync(join(root, 'scripts/lib/roadmap-style.css'), 'utf8')}</style>`))
  const passing = [today, '<?xml version="1.0" encoding="UTF-8"?>\n' + pic('a'), pic('<a href="#x">x</a>').replace('<text>', '<text fill="url(#g)">')]
  assert.deepEqual(checkAll(passing), ['ok', 'ok', 'ok'], "today's roadmap.svg; an XML declaration first; a #fragment href and url(#…)")
  const svgWith = (inner, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"${attrs}>${inner}</svg>`
  const rows = [
    [Buffer.from([0x3c, 0x73, 0x76, 0x67, 0x20, 0xff, 0x3e]), 'is not UTF-8'],
    ['<!DOCTYPE svg [<!ENTITY a "b">]>' + svgWith('&a;'), 'has a DOCTYPE or ENTITY'],
    [svgWith('<!ENTITY a "b">'), 'has a DOCTYPE or ENTITY'],
    ['#!/bin/sh\n# <svg\n', 'does not start with <svg (after an optional XML declaration)'],
    [' ' + pic('a'), 'does not start with <svg (after an optional XML declaration)'],
    ['<svg onload>', 'is not well-formed XML'],
    ['<svg>x</svg>', "its root is 'svg', not an SVG svg"],
    [svgWith('<?xml-stylesheet href="https://x/a.css"?>'), 'has a processing instruction'],
    [svgWith('<p xmlns="http://www.w3.org/1999/xhtml">x</p>'), "holds 'p', not an SVG element"],
    [svgWith('<script>alert(1)</script>'), "holds 'script'"],
    [svgWith('<foreignObject/>'), "holds 'foreignObject'"],
    [svgWith('', ' onload="x()"'), "has an 'onload' attribute"],
    [svgWith('<image href="https://x/a.png"/>'), "has an href to 'https://x/a.png', not a #fragment"],
    [svgWith('<use xlink:href="https://x/a.svg#b"/>'), "has an href to 'https://x/a.svg#b', not a #fragment"],
    [svgWith('<rect fill="url(https://x/a#b)"/>'), "has a url( to something but a #fragment in 'fill'"],
    [svgWith('<rect fill="\\75rl(x)"/>'), "has a backslash (a CSS escape) in 'fill'"],
    [svgWith('<rect style="fill: red"/>'), 'has a style attribute'],
    [svgWith('<set attributeName="href" to="https://x"/>'), "animates 'href'"],
    [svgWith('<style>@import "https://x/a.css";</style>'), 'has a <style> that is not scripts/lib/roadmap-style.css'],
    [today.replace('--bg:#fbfaf7', '--bg:#fbfaf8'), 'has a <style> that is not scripts/lib/roadmap-style.css'],
    [today.replace('</style>', '</style><style></style>'), 'has a <style> that is not scripts/lib/roadmap-style.css'],
  ]
  const got = checkAll(rows.map(([bytes]) => bytes))
  rows.forEach(([, why], i) => assert.ok(got[i].startsWith(why), `${why}: ${got[i]}`))
  // The script's own run: a refusal is its exit 1 and the reason.
  const file = join(tmp('svg-'), 'roadmap.svg')
  writeFileSync(file, svgWith('<script/>'))
  const r = spawnSync('python3', ['-I', CHECK, file], {encoding: 'utf8'})
  assert.deepEqual([r.status, r.stdout], [1, "holds 'script'\n"], r.stderr)
})

test('housekeeping push: one commit on main, the picture only; the key a file only while git pushes', () => {
  const r = run(w, svg(pic('new')))
  assert.equal(r.status, 0, r.err)
  const at = mainAt(w)
  assert.equal(shown(w, at), `${w.main} chore: refresh roadmap [skip ci] t\n${SVG}`)
  assert.equal(git(w.origin, 'show', `${at}:${SVG}`), pic('new').trim())
  assert.deepEqual(r.pushedWith, ['the deploy key'])
  assert.deepEqual(r.keyWhile, ['push'], 'the key file exists only while git pushes')
  assert.deepEqual([r.keyLeft, r.worktree], [[], ''], 'no key file or index left; the work tree untouched')
})

test('housekeeping push: main moves during the push; the commit is made again on the new main', () => {
  const before = mainAt(w)
  // Just before the first push, main moves (a merge lands), so that push is refused.
  const first = 'git update-ref refs/heads/main "$(git commit-tree main^{tree} -p main -m landed)"'
  const r = run(w, svg(pic('newer')), {first})
  assert.equal(r.status, 0, r.err)
  assert.match(r.err, /^::warning::push 1 rejected \(main moved:  ! \[rejected\] .* \(fetch first\)\); committing on the new main$/m)
  const at = mainAt(w)
  const landed = git(w.origin, 'rev-parse', `${at}^`)
  assert.equal(shown(w, landed), `${before} landed t`)
  assert.match(shown(w, at), new RegExp(`^${landed} chore: refresh roadmap \\[skip ci\\] t\n${SVG}$`))
  // git refuses the first push itself (not a fast-forward); the second reaches origin with the key.
  assert.deepEqual(r.pushedWith, ['the deploy key'])
  assert.deepEqual(r.keyWhile, ['push', 'push'])
  assert.deepEqual(r.keyLeft, [])
})

test('housekeeping push: a push refused while main stays put ends the run with git\'s reason', () => {
  const before = mainAt(w)
  const r = run(w, svg(pic('refused')), {refuse: true})
  assert.equal(r.status, 1, r.err)
  assert.match(r.err, /^::error::push 1 rejected, and main did not move:  ! \[remote rejected\] .* \(pre-receive hook declined\)$/m)
  assert.equal(mainAt(w), before)
  assert.deepEqual([r.keyWhile, r.keyLeft], [['push'], []])
})
