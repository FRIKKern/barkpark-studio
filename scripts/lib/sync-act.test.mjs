// sync-pack.yml's act job runs scripts/sync-act.sh; here the same file runs with bash against a local bare
// repo as origin, a local Barkpark and a stub gh. The plan's files are made by hand, as a hostile plan job could.
import assert from 'node:assert/strict'
import {execFileSync, spawnSync} from 'node:child_process'
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test, {after} from 'node:test'
import {fileURLToPath} from 'node:url'

import {BASH, beforeTheHelper, keyShims, PRELUDE_BREAKS} from './key-shims.mjs'
import {COPIED} from './pack.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const ACT = join(root, 'scripts/sync-act.sh')
const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], {encoding: 'utf8'}).trim()
const BRANCH = 'sync/barkpark-pack'
const made = []
const tmp = (prefix) => (made.push(mkdtempSync(join(tmpdir(), prefix))), made.at(-1))
// PATH holds only these shims and each run's own wrappers: every child act starts is checked for the key.
const shim = keyShims(join(tmp('shims-'), 'bin'), 'the deploy key')
after(() => made.forEach((d) => rmSync(d, {recursive: true, force: true})))

const env = {...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}
const git = (cwd, ...args) => execFileSync('git', args, {cwd, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']}).trim()
const write = (dir, path, text) => (mkdirSync(join(dir, path, '..'), {recursive: true}), writeFileSync(join(dir, path), text))

/**
 * A Barkpark (main: api/priv/portable_doc with a.json and conformance/conformance.mjs), an origin with main
 * (that pack as the sync writes it, SOURCE.md naming the Barkpark commit, the report, an app file, a
 * workflow) and a work clone on main.
 */
function world() {
  const base = tmp('act-')
  const barkpark = join(base, 'barkpark')
  git(base, 'init', '-q', '-b', 'main', 'barkpark')
  git(barkpark, 'config', 'uploadpack.allowFilter', 'true')
  git(base, 'init', '-q', '--bare', '-b', 'main', 'origin.git')
  const work = join(base, 'work')
  git(base, 'clone', '-q', 'origin.git', 'work')
  const w = {base, work, barkpark, origin: join(base, 'origin.git')}
  bark(w, '{}\n')
  for (const [p, t] of [['conformance/barkpark-studio.json', '{}\n'], ['app/x.ts', 'x\n'], ['.github/workflows/unit.yml', 'name: unit\n']]) write(work, p, t)
  git(work, 'add', '-A')
  git(work, 'commit', '-q', '-m', 'main')
  git(work, 'push', '-q', 'origin', 'HEAD:main')
  return {...w, main: git(work, 'rev-parse', 'HEAD')}
}
/** Barkpark's main moves to a.json = `text`; the work tree takes it as the sync does (not committed). */
function bark(w, text, branch = 'main') {
  write(w.barkpark, 'api/priv/portable_doc/a.json', text)
  write(w.barkpark, 'api/priv/portable_doc/conformance/conformance.mjs', 'export {}\n')
  if (branch !== 'main') git(w.barkpark, 'checkout', '-q', '-B', branch)
  git(w.barkpark, 'add', '-A')
  git(w.barkpark, 'commit', '-q', '--allow-empty', '-m', 'pack')
  const at = git(w.barkpark, 'rev-parse', 'HEAD')
  if (branch !== 'main') git(w.barkpark, 'checkout', '-q', 'main')
  write(w.work, 'conformance/pack/a.json', text)
  write(w.work, 'conformance/pack/conformance.mjs', 'export {}\n')
  write(w.work, 'conformance/pack/SOURCE.md', `Written by \`scripts/pack-sync.mjs\` from \`FRIKKern/barkpark\` commit \`${at}\`, path \`api/priv/portable_doc\`.\n`)
  return at
}
const branchAt = (w) => git(w.base, 'ls-remote', w.origin, `refs/heads/${BRANCH}`).split('\t')[0] || ''

/** The plan's folder: plan.json, and for a push the bundle of HEAD in `w.work` past `not`. */
function plan(w, json, not = [w.main]) {
  const dir = join(tmp('plan-'), 'plan')
  mkdirSync(dir)
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(json))
  if (json.action === 'push') git(w.work, 'bundle', 'create', '-q', join(dir, 'sync.bundle'), 'HEAD', ...not.map((c) => `^${c}`))
  return join(dir, '..')
}

/**
 * Act's script in a fresh clone of origin (the job's checkout); gh answers `pr list` with `prs`, and every
 * child is checked for the key (key-shims.mjs). Origin's pre-receive hook logs the key file as a push sees it.
 * `keyWhile`: each git command run while the key file exists; `keyLeft`: key files left in RUNNER_TEMP;
 * `sshCommand`: the checkout's core.sshCommand.
 */
function act(w, runnerTemp, prs = []) {
  const bin = tmp('gh-')
  const log = join(bin, 'calls.log')
  const pushed = join(bin, 'pushed-key.log')
  writeFileSync(join(w.origin, 'hooks/pre-receive'), `#!/bin/sh\ncat "$RUNNER_TEMP/deploy-key" >> "${pushed}" 2>/dev/null || echo none >> "${pushed}"\n`)
  chmodSync(join(w.origin, 'hooks/pre-receive'), 0o755)
  const keyWhile = join(bin, 'key-while.log')
  writeFileSync(join(bin, 'git'), `#!/bin/sh\n${shim.check('git')}\n[ ! -e "$RUNNER_TEMP/deploy-key" ] || echo "$1" >> "${keyWhile}"\nexec "${REAL_GIT}" "$@"\n`)
  chmodSync(join(bin, 'git'), 0o755)
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\n${shim.check('gh')}\necho "$*" >> "${log}"\ncase "$1 $2" in\n  "pr list") cat "${join(bin, 'prs.json')}" ;;\n  "pr view") echo MERGED ;;\nesac\n`)
  writeFileSync(join(bin, 'prs.json'), JSON.stringify(prs))
  chmodSync(join(bin, 'gh'), 0o755)
  const checkout = join(tmp('checkout-'), 'repo')
  git(w.base, 'clone', '-q', w.origin, checkout)
  const out = join(bin, 'out')
  const r = spawnSync(BASH, [ACT], {cwd: checkout, encoding: 'utf8', env: {...env, PATH: `${bin}:${shim.dir}`, RUNNER_TEMP: runnerTemp, GITHUB_OUTPUT: out, BARKPARK_GIT: w.barkpark, DEPLOY_KEY: 'the deploy key', DEPLOY_PUSH_URL: w.origin}})
  assert.deepEqual(shim.seen(), [], `a child process saw the deploy key: ${r.stdout + r.stderr}`)
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []
  const sshCommand = spawnSync('git', ['config', '--get', 'core.sshCommand'], {cwd: checkout, env, encoding: 'utf8'}).stdout.trim()
  return {
    status: r.status,
    err: r.stdout + r.stderr,
    writes: calls.filter((c) => !/^pr (list|view)/.test(c)),
    keyWhile: existsSync(keyWhile) ? readFileSync(keyWhile, 'utf8').trim().split('\n') : [],
    pushedWith: existsSync(pushed) ? readFileSync(pushed, 'utf8').trim().split('\n') : [],
    temp: runnerTemp,
    body: existsSync(join(runnerTemp, 'sync-body.md')) ? readFileSync(join(runnerTemp, 'sync-body.md'), 'utf8') : '',
    keyLeft: readdirSync(runnerTemp).filter((f) => f.startsWith('deploy-key')),
    sshCommand,
  }
}
/** Act's commit on the branch: the plan's tree and parents under act's own message, fetched into the work clone. */
function landed(w, planned) {
  const at = branchAt(w)
  git(w.work, 'fetch', '-q', 'origin', BRANCH)
  assert.equal(git(w.work, 'rev-parse', `${at}^{tree}`), git(w.work, 'rev-parse', `${planned}^{tree}`))
  assert.equal(git(w.work, 'rev-parse', `${at}^@`), git(w.work, 'rev-parse', `${planned}^@`))
  assert.match(git(w.work, 'log', '-1', '--format=%s', at), /^PortableDoc pack: sync from Barkpark [0-9a-f]{12}$/)
  return at
}
const syncPr = (number = 9, more = {}) => ({number, headRefName: BRANCH, baseRefName: 'main', isCrossRepository: false, ...more})
const commit = (w, msg) => (git(w.work, 'add', '-A'), git(w.work, 'commit', '-q', '-m', msg), git(w.work, 'rev-parse', 'HEAD'))

test('sync-act.sh handles no key itself: it sources scripts/lib/deploy-push.sh and pushes with deploy_push', () => {
  const code = readFileSync(ACT, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l))
  assert.deepEqual(code.filter((l) => /deploy-push\.sh/.test(l)), ['. "${BASH_SOURCE[0]%/*}/lib/deploy-push.sh"'])
  assert.deepEqual(code.filter((l) => /deploy_push/.test(l)).map((l) => l.trim()), ['deploy_push "$sync:refs/heads/$branch" --force-with-lease="$branch:$lease"', 'deploy_push "$start:refs/heads/$branch" --force-with-lease="$branch:$sync"'])
  assert.deepEqual(code.filter((l) => /DEPLOY_|deploy_key|keyfile/.test(l) || /ssh|git push|\btrap\b/i.test(l)), [], 'nothing else touches the key')

  // Before that line DEPLOY_KEY is still in the env: only what beforeTheHelper allows, nothing that starts a process.
  const text = readFileSync(ACT, 'utf8')
  assert.deepEqual(beforeTheHelper(text), [])
  assert.deepEqual(beforeTheHelper(text.replace('set -euo pipefail\n', `set -euo pipefail\ny='a[b]'\n`)), [], 'a single-quoted value holds anything')
  for (const [added, named = added] of PRELUDE_BREAKS)
    assert.deepEqual(beforeTheHelper(text.replace('set -euo pipefail\n', `set -euo pipefail\n${added}\n`)), named.split('\n'), added)
})

test('act pushes a sync commit on main and opens the PR; it refuses to push one that leaves the pack', () => {
  const ok = world()
  bark(ok, '{"v": 2}\n')
  const synced = commit(ok, 'sync')
  const r = act(ok, plan(ok, {action: 'push', main: ok.main}))
  assert.equal(r.status, 0, r.err)
  assert.match(r.writes.join('\n'), /^pr create --head sync\/barkpark-pack --base main/m)
  // Act's own commit: the plan's tree on main under act's message; then the empty commit that starts the
  // checks, made without a checkout. The PR's title and body are act's, from the Barkpark commit it checked.
  const at = git(ok.barkpark, 'rev-parse', 'HEAD')
  assert.equal(git(ok.origin, 'rev-parse', `${BRANCH}^^{tree}`), git(ok.work, 'rev-parse', `${synced}^{tree}`))
  assert.equal(git(ok.origin, 'rev-parse', `${BRANCH}^^`), ok.main)
  assert.equal(git(ok.origin, 'log', '-1', '--format=%s', `${BRANCH}^`), `PortableDoc pack: sync from Barkpark ${at.slice(0, 12)}`)
  assert.equal(git(ok.origin, 'log', '-1', '--format=%s', BRANCH), 'Start the checks')
  assert.ok(r.writes.includes(`pr create --head ${BRANCH} --base main --title PortableDoc pack: sync from Barkpark ${at.slice(0, 12)} --body-file ${r.temp}/sync-body.md`), r.writes.join('\n'))
  assert.match(r.body, new RegExp(`^Written by \`scripts/pack-sync\.mjs\` from \\[\`FRIKKern/barkpark\` ${at.slice(0, 12)}\\]\\(https://github\\.com/FRIKKern/barkpark/commit/${at}\\)`))
  // The deploy key: a file only while each push runs, gone after; never in gh's env.
  assert.deepEqual(r.pushedWith, ['the deploy key', 'the deploy key'])
  assert.deepEqual(r.keyWhile.filter((c) => c !== 'receive-pack'), ['push', 'push'], 'the key file exists only while git pushes')
  assert.deepEqual(r.keyLeft, [])

  const refused = (name, change, needle) => {
    const w = world()
    change(w)
    const r = act(w, plan(w, {action: 'push', main: w.main}))
    assert.equal(r.status, 1, `${name}: ${r.err}`)
    assert.match(r.err, needle, name)
    assert.equal(branchAt(w), '', `${name}: nothing pushed`)
    assert.deepEqual(r.writes, [], `${name}: no PR`)
    assert.deepEqual([r.keyWhile, r.pushedWith, r.keyLeft, r.sshCommand], [[], [], [], ''], `${name}: the key never written`)
  }
  const mv = (from, to) => (w) => (git(w.work, 'mv', from, to), commit(w, 'sync'))
  refused('a file moved out of app/ into the pack', mv('app/x.ts', 'conformance/pack/x.ts'), /D 100644 000000 app\/x\.ts/)
  refused('a workflow moved into the pack', mv('.github/workflows/unit.yml', 'conformance/pack/unit.yml'), /\.github\/workflows\/unit\.yml/)
  refused('a symlink in the pack', (w) => (execFileSync('ln', ['-s', '../../app/x.ts', join(w.work, 'conformance/pack/link')]), commit(w, 'sync')), /120000 conformance\/pack\/link/)
  refused('an executable in the pack', (w) => (write(w.work, 'conformance/pack/run.sh', 'x\n'), chmodSync(join(w.work, 'conformance/pack/run.sh'), 0o755), commit(w, 'sync')), /100755 conformance\/pack\/run\.sh/)
  refused('a .. entry in the pack', (w) => dotDot(w), /conformance\/pack\/\.\./)
  refused('a commit on top of another commit', (w) => (write(w.work, 'app/x.ts', 'y\n'), commit(w, 'app'), bark(w, '[]\n'), commit(w, 'sync')), /not on main/)
  refused('a pack file name outside [A-Za-z0-9._/-]', (w) => (write(w.work, 'conformance/pack/a b.json', '{}\n'), commit(w, 'sync')), /conformance\/pack\/a b\.json/)
  // The pack's bytes: Barkpark's own at the commit SOURCE.md names, on Barkpark's main.
  refused('a pack file not as Barkpark holds it', (w) => (bark(w, '{"v": 2}\n'), write(w.work, 'conformance/pack/a.json', '{"v": 666}\n'), commit(w, 'sync')), /the pack differs from Barkpark [0-9a-f]{40}: a\.json/)
  refused('a pack file Barkpark lacks', (w) => (bark(w, '{"v": 2}\n'), write(w.work, 'conformance/pack/extra.mjs', 'x\n'), commit(w, 'sync')), /the pack differs from Barkpark [0-9a-f]{40}: extra\.mjs/)
  refused('a Barkpark commit off its main', (w) => (bark(w, '{"v": 2}\n', 'side'), commit(w, 'sync')), /is not on Barkpark's main/)
  // Barkpark's history rewritten, so the commit main's SOURCE.md names leaves its main: every push fails safe.
  refused('a Barkpark history rewrite', (w) => (git(w.barkpark, 'commit', '-q', '--amend', '-m', 'rewritten'), bark(w, '{"v": 2}\n'), commit(w, 'sync')), /Barkpark [0-9a-f]{40}, which main's SOURCE\.md names, is not on Barkpark's main \(history rewritten\?\): sync by hand/)
  // An older Barkpark pack than main's (main's SOURCE.md names a later commit): refused.
  {
    const w = world()
    const old = git(w.barkpark, 'rev-parse', 'HEAD')
    bark(w, '{"v": 2}\n')
    const main = commit(w, 'pack from a later Barkpark commit')
    git(w.work, 'push', '-q', 'origin', 'HEAD:main')
    write(w.work, 'conformance/pack/a.json', '{}\n')
    write(w.work, 'conformance/pack/SOURCE.md', `commit \`${old}\`\n`)
    commit(w, 'sync')
    const r = act(w, plan(w, {action: 'push', main}, [main]))
    assert.equal(r.status, 1, r.err)
    assert.match(r.err, new RegExp(`Barkpark ${old} is not a descendant of main's SOURCE commit [0-9a-f]{40}$`, 'm'))
    assert.equal(branchAt(w), '')
  }
  refused('SOURCE.md naming no commit', (w) => (bark(w, '{"v": 2}\n'), write(w.work, 'conformance/pack/SOURCE.md', 'hand-written\n'), commit(w, 'sync')), /SOURCE\.md names no Barkpark commit/)
  // A plan value with a line break stays on the error line.
  const w = world()
  bark(w, '{"v": 2}\n')
  commit(w, 'sync')
  const forged = act(w, plan(w, {action: 'push', main: 'x\n::set-output name=merged::true'}))
  assert.equal(forged.status, 1)
  assert.match(forged.err, /^::error::main x%0A::set-output name=merged::true$/m)
  assert.doesNotMatch(forged.err, /^::set-output/m)
})

test("act's Barkpark paths are the sync's: conformance.mjs and its types from Barkpark's conformance/", () => {
  assert.deepEqual(Object.entries(COPIED).filter(([mine, theirs]) => mine !== theirs), [['conformance.mjs', 'conformance/conformance.mjs'], ['conformance.d.mts', 'conformance/conformance.d.mts']])
  assert.match(readFileSync(ACT, 'utf8'), /^ {8}conformance\.mjs \| conformance\.d\.mts\) src=conformance\/\$rel ;;$/m)
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
  // No sync PR open: close and land do nothing, and the key is never written.
  for (const json of [{action: 'close'}, {action: 'land', head: w.main}]) {
    const r = act(w, plan(w, json), [other])
    assert.equal(r.status, 0, r.err)
    assert.match(r.err, /no sync PR open/)
    assert.deepEqual(r.writes, [])
    assert.deepEqual([r.keyWhile, r.pushedWith, r.keyLeft, r.sshCommand], [[], [], [], ''])
  }
  // The sync PR: closed by its own number only while its head's pack is main's, byte for byte.
  write(w.work, 'conformance/pack/a.json', '{"v": "not main"}\n')
  git(w.work, 'push', '-q', 'origin', `${commit(w, 'pack differs')}:refs/heads/${BRANCH}`)
  const differs = act(w, plan(w, {action: 'close', number: 9}), [syncPr(9)])
  assert.equal(differs.status, 1, differs.err)
  assert.match(differs.err, /#9's pack differs from main's/)
  assert.deepEqual(differs.writes, [])
  git(w.work, 'reset', '-q', '--hard', w.main)
  write(w.work, 'conformance/barkpark-studio.json', '{"rows": "accepted"}\n')
  git(w.work, 'push', '-q', '-f', 'origin', `${commit(w, 'hand: accept rows')}:refs/heads/${BRANCH}`)
  assert.deepEqual(act(w, plan(w, {action: 'close', number: 9}), [syncPr(9)]).writes, ['pr close 9 --comment main already carries these files: nothing left to sync.'], 'the branch stays')
  git(w.work, 'reset', '-q', '--hard', w.main)
  // And merged by its own number.
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
  bark(w, '{"v": 3}\n')
  commit(w, 'sync')
  const r = act(w, plan(w, {action: 'push', number: 9, main: w.main}), [syncPr(9)])
  assert.equal(r.status, 1, r.err)
  assert.match(r.err, /not on #9's head merged with main/)
  assert.equal(branchAt(w), hand)
  // On the head, which holds that main already: pushed, the hand commit kept, the PR edited.
  git(w.work, 'reset', '-q', '--hard', hand)
  bark(w, '{"v": 3}\n')
  const planned = commit(w, 'sync')
  const ok = act(w, plan(w, {action: 'push', number: 9, main: w.main}, [hand]), [syncPr(9)])
  assert.equal(ok.status, 0, ok.err)
  const first = landed(w, planned)
  assert.match(ok.writes[0], /^pr edit 9 --title/)
  // Main moves; the next sync merges it into the head: pushed on top, the hand commit still there.
  git(w.work, 'reset', '-q', '--hard', w.main)
  write(w.work, 'app/x.ts', 'moved\n')
  const main2 = commit(w, 'main moves')
  git(w.work, 'push', '-q', 'origin', 'HEAD:main')
  git(w.work, 'reset', '-q', '--hard', first)
  git(w.work, 'merge', '-q', '--no-edit', main2)
  bark(w, '{"v": 4}\n')
  const planned2 = commit(w, 'sync')
  const ok2 = act(w, plan(w, {action: 'push', number: 9, main: main2}, [first, main2]), [syncPr(9)])
  assert.equal(ok2.status, 0, ok2.err)
  const second = landed(w, planned2)
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
  bark(w, '{"v": 5}\n')
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
  assert.deepEqual([r2.keyWhile, r2.pushedWith, r2.keyLeft, r2.sshCommand], [[], [], [], ''], 'a refused bundle: the key never written')
})
