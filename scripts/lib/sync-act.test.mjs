// sync-pack.yml's act job, its own script as the workflow holds it, run with bash against a local bare
// repo as origin and a stub gh. The plan's files are made by hand here, as a hostile plan job could.
import assert from 'node:assert/strict'
import {execFileSync, spawnSync} from 'node:child_process'
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test, {after} from 'node:test'
import {fileURLToPath} from 'node:url'

import {jobSteps, runOf} from './workflow-keys.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const ACT = runOf(jobSteps(readFileSync(join(root, '.github/workflows/sync-pack.yml'), 'utf8')).act.find((s) => /id: write/.test(s)))
const BRANCH = 'sync/barkpark-pack'
const made = []
const tmp = (prefix) => (made.push(mkdtempSync(join(tmpdir(), prefix))), made.at(-1))
after(() => made.forEach((d) => rmSync(d, {recursive: true, force: true})))

const env = {...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}
const git = (cwd, ...args) => execFileSync('git', args, {cwd, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']}).trim()
const write = (dir, path, text) => (mkdirSync(join(dir, path, '..'), {recursive: true}), writeFileSync(join(dir, path), text))

/** An origin with main (a pack, its report, an app file, a workflow) and a work clone on main. */
function world() {
  const base = tmp('act-')
  git(base, 'init', '-q', '--bare', '-b', 'main', 'origin.git')
  const work = join(base, 'work')
  git(base, 'clone', '-q', 'origin.git', 'work')
  for (const [p, t] of [['conformance/pack/a.json', '{}\n'], ['conformance/barkpark-studio.json', '{}\n'], ['app/x.ts', 'x\n'], ['.github/workflows/unit.yml', 'name: unit\n']]) write(work, p, t)
  git(work, 'add', '-A')
  git(work, 'commit', '-q', '-m', 'main')
  git(work, 'push', '-q', 'origin', 'HEAD:main')
  return {base, work, origin: join(base, 'origin.git'), main: git(work, 'rev-parse', 'HEAD')}
}
const branchAt = (w) => git(w.base, 'ls-remote', w.origin, `refs/heads/${BRANCH}`).split('\t')[0] || ''

/** The plan's folder: plan.json, and for a push the bundle of HEAD in `w.work` past `not`. */
function plan(w, json, not = [w.main]) {
  const dir = join(tmp('plan-'), 'plan')
  mkdirSync(dir)
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(json))
  writeFileSync(join(dir, 'title.txt'), 'PortableDoc pack: sync\n')
  writeFileSync(join(dir, 'body.md'), 'body\n')
  if (json.action === 'push') git(w.work, 'bundle', 'create', '-q', join(dir, 'sync.bundle'), 'HEAD', ...not.map((c) => `^${c}`))
  return join(dir, '..')
}

/** Act's script in a fresh clone of origin (the job's checkout); gh answers `pr list` with `prs`. */
function act(w, runnerTemp, prs = []) {
  const bin = tmp('gh-')
  const log = join(bin, 'calls.log')
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\necho "$*" >> "${log}"\ncase "$1 $2" in\n  "pr list") cat "${join(bin, 'prs.json')}" ;;\n  "pr view") echo MERGED ;;\nesac\n`)
  writeFileSync(join(bin, 'prs.json'), JSON.stringify(prs))
  chmodSync(join(bin, 'gh'), 0o755)
  const checkout = join(tmp('checkout-'), 'repo')
  git(w.base, 'clone', '-q', w.origin, checkout)
  const out = join(bin, 'out')
  const r = spawnSync('bash', ['-c', ACT], {cwd: checkout, encoding: 'utf8', env: {...env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: runnerTemp, GITHUB_OUTPUT: out}})
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []
  return {status: r.status, err: r.stdout + r.stderr, writes: calls.filter((c) => !/^pr (list|view)/.test(c))}
}
const syncPr = (number = 9, more = {}) => ({number, headRefName: BRANCH, baseRefName: 'main', isCrossRepository: false, ...more})
const commit = (w, msg) => (git(w.work, 'add', '-A'), git(w.work, 'commit', '-q', '-m', msg), git(w.work, 'rev-parse', 'HEAD'))

test('act pushes a sync commit on main and opens the PR; it refuses to push one that leaves the pack', () => {
  const ok = world()
  write(ok.work, 'conformance/pack/a.json', '{"v": 2}\n')
  commit(ok, 'sync')
  const r = act(ok, plan(ok, {action: 'push', main: ok.main}))
  assert.equal(r.status, 0, r.err)
  assert.notEqual(branchAt(ok), '')
  assert.match(r.writes.join('\n'), /^pr create --head sync\/barkpark-pack --base main/m)

  const refused = (name, change, needle) => {
    const w = world()
    change(w)
    const r = act(w, plan(w, {action: 'push', main: w.main}))
    assert.equal(r.status, 1, `${name}: ${r.err}`)
    assert.match(r.err, needle, name)
    assert.equal(branchAt(w), '', `${name}: nothing pushed`)
    assert.deepEqual(r.writes, [], `${name}: no PR`)
  }
  const mv = (from, to) => (w) => (git(w.work, 'mv', from, to), commit(w, 'sync'))
  refused('a file moved out of app/ into the pack', mv('app/x.ts', 'conformance/pack/x.ts'), /D 100644 000000 app\/x\.ts/)
  refused('a workflow moved into the pack', mv('.github/workflows/unit.yml', 'conformance/pack/unit.yml'), /\.github\/workflows\/unit\.yml/)
  refused('a symlink in the pack', (w) => (execFileSync('ln', ['-s', '../../app/x.ts', join(w.work, 'conformance/pack/link')]), commit(w, 'sync')), /120000 conformance\/pack\/link/)
  refused('an executable in the pack', (w) => (write(w.work, 'conformance/pack/run.sh', 'x\n'), chmodSync(join(w.work, 'conformance/pack/run.sh'), 0o755), commit(w, 'sync')), /100755 conformance\/pack\/run\.sh/)
  refused('a .. entry in the pack', (w) => dotDot(w), /conformance\/pack\/\.\./)
  refused('a commit on top of another commit', (w) => (write(w.work, 'app/x.ts', 'y\n'), commit(w, 'app'), write(w.work, 'conformance/pack/a.json', '[]\n'), commit(w, 'sync')), /not on main/)
})

/** A tree entry named `..` under conformance/pack (git refuses to make one from a work tree). */
function dotDot(w) {
  const blob = git(w.work, 'rev-parse', 'HEAD:conformance/pack/a.json')
  const entry = (mode, name, sha) => Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(sha, 'hex')])
  const tree = (buf) => execFileSync('git', ['hash-object', '-t', 'tree', '--literally', '-w', '--stdin'], {cwd: w.work, env, input: buf, encoding: 'utf8'}).trim()
  const pack = tree(Buffer.concat([entry('100644', '..', blob), entry('100644', 'a.json', blob)]))
  const conf = tree(Buffer.concat([entry('100644', 'barkpark-studio.json', git(w.work, 'rev-parse', 'HEAD:conformance/barkpark-studio.json')), entry('40000', 'pack', pack)]))
  const top = tree(Buffer.concat([entry('40000', '.github', git(w.work, 'rev-parse', 'HEAD:.github')), entry('40000', 'app', git(w.work, 'rev-parse', 'HEAD:app')), entry('40000', 'conformance', conf)]))
  const c = execFileSync('git', ['commit-tree', top, '-p', 'HEAD', '-m', 'sync'], {cwd: w.work, env, encoding: 'utf8'}).trim()
  git(w.work, 'update-ref', 'HEAD', c)
}

test('act finds the sync PR itself: a plan naming another PR is refused for close, land and push', () => {
  const w = world()
  const other = syncPr(1287, {headRefName: 'feat/other'})
  for (const json of [{action: 'close', number: '1287'}, {action: 'land', number: '1287', head: w.main}, {action: 'close', number: '1290'}]) {
    const r = act(w, plan(w, json), [syncPr(9), other])
    assert.equal(r.status, 1, `${json.action} ${json.number}: ${r.err}`)
    assert.match(r.err, /the sync PR is #9/)
    assert.deepEqual(r.writes, [])
  }
  // A fork's PR from a branch of the same name is not the sync PR.
  const fork = act(w, plan(w, {action: 'close', number: '41'}), [syncPr(41, {isCrossRepository: true})])
  assert.equal(fork.status, 1, fork.err)
  assert.deepEqual(fork.writes, [])
  // No sync PR open: close and land do nothing.
  for (const json of [{action: 'close'}, {action: 'land', head: w.main}]) {
    const r = act(w, plan(w, json), [other])
    assert.equal(r.status, 0, r.err)
    assert.match(r.err, /no sync PR open/)
    assert.deepEqual(r.writes, [])
  }
  // The sync PR: closed and merged by its own number.
  assert.deepEqual(act(w, plan(w, {action: 'close', number: 9}), [syncPr(9)]).writes, ["pr close 9 --delete-branch --comment main already carries these files: nothing left to sync."])
  assert.match(act(w, plan(w, {action: 'land', number: 9, head: w.main}), [syncPr(9)]).writes[0], /^pr merge 9 --squash --delete-branch --match-head-commit [0-9a-f]{40}$/)
})

test('act, with the sync PR open: the commit sits on its head with main merged in, never straight on main', () => {
  const w = world()
  // The PR's branch: a hand commit on main.
  write(w.work, 'conformance/barkpark-studio.json', '{"rows": "accepted"}\n')
  const hand = commit(w, 'hand: accept rows')
  git(w.work, 'push', '-q', 'origin', `HEAD:refs/heads/${BRANCH}`)
  // Straight on main, the hand commit dropped: refused.
  git(w.work, 'reset', '-q', '--hard', w.main)
  write(w.work, 'conformance/pack/a.json', '{"v": 3}\n')
  commit(w, 'sync')
  const r = act(w, plan(w, {action: 'push', number: 9, main: w.main}), [syncPr(9)])
  assert.equal(r.status, 1, r.err)
  assert.match(r.err, /not on #9's head merged with main/)
  assert.equal(branchAt(w), hand)
  // On the head, which holds that main already: pushed, the hand commit kept, the PR edited.
  git(w.work, 'reset', '-q', '--hard', hand)
  write(w.work, 'conformance/pack/a.json', '{"v": 3}\n')
  const first = commit(w, 'sync')
  const ok = act(w, plan(w, {action: 'push', number: 9, main: w.main}, [hand]), [syncPr(9)])
  assert.equal(ok.status, 0, ok.err)
  assert.equal(branchAt(w), first)
  assert.match(ok.writes[0], /^pr edit 9 --title/)
  // Main moves; the next sync merges it into the head: pushed on top, the hand commit still there.
  git(w.work, 'reset', '-q', '--hard', w.main)
  write(w.work, 'app/x.ts', 'moved\n')
  const main2 = commit(w, 'main moves')
  git(w.work, 'push', '-q', 'origin', 'HEAD:main')
  git(w.work, 'reset', '-q', '--hard', first)
  git(w.work, 'merge', '-q', '--no-edit', main2)
  write(w.work, 'conformance/pack/a.json', '{"v": 4}\n')
  const second = commit(w, 'sync')
  const ok2 = act(w, plan(w, {action: 'push', number: 9, main: main2}, [first, main2]), [syncPr(9)])
  assert.equal(ok2.status, 0, ok2.err)
  assert.equal(branchAt(w), second)
  assert.equal(git(w.origin, 'merge-base', '--is-ancestor', hand, BRANCH), '')
  // A merge carrying one more change than git's own merge: refused.
  git(w.work, 'reset', '-q', '--hard', second)
  write(w.work, 'app/x.ts', 'main again\n')
  git(w.work, 'checkout', '-q', '-b', 'm3', main2)
  write(w.work, 'README.md', 'r\n')
  const main3 = commit(w, 'main again')
  git(w.work, 'push', '-q', 'origin', 'HEAD:main')
  git(w.work, 'checkout', '-q', '--detach', second)
  git(w.work, 'merge', '-q', '--no-commit', main3)
  write(w.work, 'app/evil.ts', 'x\n')
  commit(w, 'merge')
  write(w.work, 'conformance/pack/a.json', '{"v": 5}\n')
  commit(w, 'sync')
  const r3 = act(w, plan(w, {action: 'push', number: 9, main: main3}, [second, main3]), [syncPr(9)])
  assert.equal(r3.status, 1, r3.err)
  assert.match(r3.err, /not on #9's head merged with main/)
  assert.equal(branchAt(w), second)
  // No valid bundle: refused before any fetch from it.
  const bad = plan(w, {action: 'push', number: 9, main: main3}, [second, main3])
  writeFileSync(join(bad, 'plan', 'sync.bundle'), 'not a bundle')
  const r2 = act(w, bad, [syncPr(9)])
  assert.equal(r2.status, 1)
  assert.match(r2.err, /no valid sync\.bundle/)
})
