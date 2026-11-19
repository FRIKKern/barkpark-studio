// sync-pack.yml's act job runs scripts/sync-act.sh; here the same file runs with bash against a local bare
// repo as origin, a local Barkpark and a stub gh. The plan's files are made by hand, as a hostile plan job could.
// The commits are made once, up front, most by one `git fast-import` per side; each case gets its own origin, a
// bare repo that borrows those objects (objects/info/alternates) with its refs written in, and the cases run
// side by side.
import assert from 'node:assert/strict'
import {execFileSync, spawn} from 'node:child_process'
import {chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {availableParallelism, tmpdir} from 'node:os'
import {join} from 'node:path'
import test, {after} from 'node:test'
import {fileURLToPath} from 'node:url'

import {BASH, beforeTheHelper, keyShims, PRELUDE_BREAKS, withLine} from './key-shims.mjs'
import {COPIED} from './pack.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const ACT = join(root, 'scripts/sync-act.sh')
const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], {encoding: 'utf8'}).trim()
const BRANCH = 'sync/barkpark-pack'
const made = []
const tmp = (prefix) => (made.push(mkdtempSync(join(tmpdir(), prefix))), made.at(-1))
const KEY = 'the deploy key'
after(() => made.forEach((d) => rmSync(d, {recursive: true, force: true})))

const env = {...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}
const git = (cwd, ...args) => execFileSync('git', args, {cwd, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']}).trim()
const write = (dir, path, text) => (mkdirSync(join(dir, path, '..'), {recursive: true}), writeFileSync(join(dir, path), text))
/** A child run without blocking the other cases: its status and output. */
const run = (cmd, args, {input, ...opts} = {}) =>
  new Promise((resolve, reject) => {
    const c = spawn(cmd, args, {env, ...opts})
    let stdout = ''
    let stderr = ''
    c.stdout.on('data', (d) => (stdout += d))
    c.stderr.on('data', (d) => (stderr += d))
    c.on('error', reject)
    c.on('close', (status) => resolve({status, stdout, stderr}))
    c.stdin.end(input)
  })
const gitRun = async (cwd, args, opts) => {
  const r = await run('git', args, {cwd, ...opts})
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
// At most one act per core at a time; an `urgent` one (a step of a chain) goes to the head of the queue.
let free = availableParallelism()
const queued = []
async function slot(fn, urgent) {
  if (free > 0) free--
  else await new Promise((go) => (urgent ? queued.unshift(go) : queued.push(go)))
  try {
    return await fn()
  } finally {
    if (queued.length) queued.shift()()
    else free++
  }
}
// The --test-name-pattern and --test-skip-pattern node was given (each a regexp, or /regexp/flags).
const patterns = (flag) =>
  process.execArgv
    .flatMap((a, i, all) => (a === flag ? [all[i + 1]] : a.startsWith(`${flag}=`) ? [a.slice(flag.length + 1)] : []))
    .map((p) => (/^\/(.*)\/([a-z]*)$/s.exec(p) ?? [, p, ''])).map(([, re, flags]) => new RegExp(re, flags))
const only = patterns('--test-name-pattern')
const skip = patterns('--test-skip-pattern')
/**
 * A test whose body starts now, while the tests before it still run (the runner awaits the same promise);
 * a test the name patterns leave out never starts its acts.
 */
function earlyTest(name, body) {
  if ((only.length && !only.some((r) => r.test(name))) || skip.some((r) => r.test(name))) return test(name, body)
  const running = body()
  running.catch(() => {})
  test(name, () => running)
}

const base = tmp('act-')
const TEMPLATE = join(base, 'template.git')
git(base, 'init', '-q', '--bare', '-b', 'main', TEMPLATE)
git(TEMPLATE, 'config', 'uploadpack.allowFilter', 'true')
rmSync(join(TEMPLATE, 'hooks'), {recursive: true})
mkdirSync(join(TEMPLATE, 'hooks'))
/** A bare repo borrowing the objects of `lenders` (bare repos), with `refs` (path → sha) written in. */
function borrower(lenders, refs) {
  const dir = join(tmp('repo-'), 'repo.git')
  cpSync(TEMPLATE, dir, {recursive: true})
  writeFileSync(join(dir, 'objects/info/alternates'), lenders.map((l) => join(l, 'objects')).join('\n') + '\n')
  for (const [ref, sha] of Object.entries(refs)) write(dir, ref, `${sha}\n`)
  return dir
}

/**
 * One `git fast-import` into `dir`: commits {name, from, merge, files}, where files maps a path to its text,
 * [mode, text] or null (deleted), and from/merge name a commit of this batch or a sha. Returns name → sha.
 */
function fastImport(dir, commits) {
  const marks = new Map(commits.map((c, i) => [c.name, `:${i + 1}`]))
  const data = (text) => `data ${Buffer.byteLength(text)}\n${text}`
  const input = commits.map((c, i) => {
    const lines = [`commit refs/fixtures/${c.name}`, `mark :${i + 1}`, 'committer t <t@t> 1700000000 +0000', data(c.name)]
    if (c.from) lines.push(`from ${marks.get(c.from) ?? c.from}`)
    if (c.merge) lines.push(`merge ${marks.get(c.merge) ?? c.merge}`)
    for (const [path, f] of Object.entries(c.files ?? {})) {
      if (f === null) lines.push(`D ${path}`)
      else lines.push(`M ${Array.isArray(f) ? f[0] : '100644'} inline ${path}`, data(Array.isArray(f) ? f[1] : f))
    }
    return lines.join('\n') + '\n'
  })
  const out = join(tmp('marks-'), 'marks')
  return {input: input.join(''), args: ['fast-import', '--quiet', `--export-marks=${out}`], read: () => readMarks(out, commits)}
}
const readMarks = (out, commits) => Object.fromEntries(readFileSync(out, 'utf8').trim().split('\n').map((l) => l.split(' ')).map(([m, sha]) => [commits[m.slice(1) - 1].name, sha]))
const importNow = (dir, commits) => {
  const f = fastImport(dir, commits)
  execFileSync('git', f.args, {cwd: dir, env, input: f.input})
  return f.read()
}
/** The same, while other cases run; `borrowing` lends a case origin's objects (act's own commits). */
const importLater = async (dir, commits, borrowing) => {
  const f = fastImport(dir, commits)
  await gitRun(dir, f.args, {input: f.input, env: {...env, GIT_ALTERNATE_OBJECT_DIRECTORIES: join(borrowing, 'objects')}})
  return f.read()
}

// Barkpark: api/priv/portable_doc with a.json and conformance/conformance.mjs. Main runs b0 to b6; `side` is
// off it; `rewritten` starts a second history, as an amend and force push on Barkpark's main would.
const BARK = join(base, 'barkpark.git')
git(base, 'init', '-q', '--bare', '-b', 'main', BARK)
const barkFiles = (text) => ({'api/priv/portable_doc/a.json': text, 'api/priv/portable_doc/conformance/conformance.mjs': 'export {}\n'})
const B = importNow(BARK, [
  {name: 'b0', files: barkFiles('{}\n')},
  ...[2, 3, 4, 5].map((v) => ({name: `b${v}`, from: v === 2 ? 'b0' : `b${v - 1}`, files: barkFiles(`{"v": ${v}}\n`)})),
  // b6 adds entries that are not plain files: a symlink whose target text is a file's bytes, and an executable.
  {name: 'b6', from: 'b5', files: {'api/priv/portable_doc/link.json': ['120000', '{"v": 6}\n'], 'api/priv/portable_doc/run.mjs': ['100755', 'x\n']}},
  {name: 'side', from: 'b0', files: barkFiles('{"v": 2}\n')},
  {name: 'rewritten', files: barkFiles('{}\n')},
  {name: 'rewritten-2', from: 'rewritten', files: barkFiles('{"v": 2}\n')},
])
const BARKPARK = borrower([BARK], {'refs/heads/main': B.b6})
const BARKPARK_REWRITTEN = borrower([BARK], {'refs/heads/main': B['rewritten-2']})

/** The pack as the sync writes it from Barkpark commit `at`, a.json = `text`. */
const pack = (text, at) => ({
  'conformance/pack/a.json': text,
  'conformance/pack/conformance.mjs': 'export {}\n',
  'conformance/pack/SOURCE.md': `Written by \`scripts/pack-sync.mjs\` from \`FRIKKern/barkpark\` commit \`${at}\`, path \`api/priv/portable_doc\`.\n`,
})
// The push cases refused: each a sync commit on `from` (main) with `files`, and the error it must give.
// The `..` row's commit is made by hand (dotDot) and found again by this one name.
const DOT_DOT = 'a .. entry in the pack'
const REFUSED = [
  ['a file moved out of app/ into the pack', {'app/x.ts': null, 'conformance/pack/x.ts': 'x\n'}, /D 100644 000000 app\/x\.ts/],
  ['a workflow moved into the pack', {'.github/workflows/unit.yml': null, 'conformance/pack/unit.yml': 'name: unit\n'}, /\.github\/workflows\/unit\.yml/],
  ['a symlink in the pack', {'conformance/pack/link': ['120000', '../../app/x.ts']}, /120000 conformance\/pack\/link/],
  ['an executable in the pack', {'conformance/pack/run.sh': ['100755', 'x\n']}, /100755 conformance\/pack\/run\.sh/],
  // A tree entry named `..`: its commit is made by hand below (dotDot), as git refuses to make one otherwise.
  [DOT_DOT, {}, /conformance\/pack\/\.\./],
  ['a commit on top of another commit', pack('{"v": 2}\n', B.b2), /not on main/, {from: 'app-y'}],
  ['a pack file name outside [A-Za-z0-9._/-]', {'conformance/pack/a b.json': '{}\n'}, /conformance\/pack\/a b\.json/],
  // The pack's bytes: Barkpark's own at the commit SOURCE.md names, on Barkpark's main.
  ['a pack file not as Barkpark holds it', {...pack('{"v": 2}\n', B.b2), 'conformance/pack/a.json': '{"v": 666}\n'}, /the pack differs from Barkpark [0-9a-f]{40}: a\.json/],
  ['a pack file Barkpark lacks', {...pack('{"v": 2}\n', B.b2), 'conformance/pack/extra.mjs': 'x\n'}, /the pack differs from Barkpark [0-9a-f]{40}: extra\.mjs/],
  // Barkpark's entry must be a plain file (100644): the same bytes from a symlink or an executable are refused.
  ['a pack file that is a symlink in Barkpark', {...pack('{"v": 5}\n', B.b6), 'conformance/pack/link.json': '{"v": 6}\n'}, /the pack differs from Barkpark [0-9a-f]{40}: link\.json; $/m],
  ['a pack file that is an executable in Barkpark', {...pack('{"v": 5}\n', B.b6), 'conformance/pack/run.mjs': 'x\n'}, /the pack differs from Barkpark [0-9a-f]{40}: run\.mjs; $/m],
  ["a Barkpark commit off its main", pack('{"v": 2}\n', B.side), /is not on Barkpark's main/],
  // Barkpark's history rewritten, so the commit main's SOURCE.md names leaves its main: every push fails safe.
  ['a Barkpark history rewrite', pack('{"v": 2}\n', B['rewritten-2']), /Barkpark [0-9a-f]{40}, which main's SOURCE\.md names, is not on Barkpark's main \(history rewritten\?\): sync by hand/, {barkpark: BARKPARK_REWRITTEN}],
  // An older Barkpark pack than main's (main's SOURCE.md names a later commit).
  ['an older Barkpark pack than main\'s', {'conformance/pack/a.json': '{}\n', 'conformance/pack/SOURCE.md': `commit \`${B.b0}\`\n`}, new RegExp(`Barkpark ${B.b0} is not a descendant of main's SOURCE commit ${B.b2}$`, 'm'), {from: 'later', main: 'later'}],
  ['SOURCE.md naming no commit', {...pack('{"v": 2}\n', B.b2), 'conformance/pack/SOURCE.md': 'hand-written\n'}, /SOURCE\.md names no Barkpark commit/],
]

// The studio: main (the pack from b0, SOURCE.md naming it, the report, an app file, a workflow) and every
// commit the cases plan, push or hold on the sync branch.
const STUDIO = join(base, 'studio.git')
git(base, 'init', '-q', '--bare', '-b', 'main', STUDIO)
const S = importNow(STUDIO, [
  {name: 'main', files: {...pack('{}\n', B.b0), 'conformance/barkpark-studio.json': '{}\n', 'app/x.ts': 'x\n', '.github/workflows/unit.yml': 'name: unit\n'}},
  {name: 'synced', from: 'main', files: pack('{"v": 2}\n', B.b2)},
  {name: 'app-y', from: 'main', files: {'app/x.ts': 'y\n'}},
  {name: 'later', from: 'main', files: pack('{"v": 2}\n', B.b2)},
  ...REFUSED.map(([, files, , o = {}], i) => ({name: `refused-${i}`, from: o.from ?? 'main', files})),
  {name: 'differs', from: 'main', files: {'conformance/pack/a.json': '{"v": "not main"}\n'}},
  {name: 'hand', from: 'main', files: {'conformance/barkpark-studio.json': '{"rows": "accepted"}\n'}},
  {name: 'straight', from: 'main', files: pack('{"v": 3}\n', B.b3)},
  {name: 'on-head', from: 'hand', files: pack('{"v": 3}\n', B.b3)},
  {name: 'main-2', from: 'main', files: {'app/x.ts': 'moved\n'}},
  {name: 'main-3', from: 'main-2', files: {'app/x.ts': 'main again\n', 'README.md': 'r\n'}},
])
const DOT_DOT_AT = REFUSED.findIndex(([name]) => name === DOT_DOT)
S[`refused-${DOT_DOT_AT}`] = dotDot(S.main)
/** A commit on `main` whose conformance/pack holds a tree entry named `..` (and a.json). */
function dotDot(main) {
  const [a, report, github, app] = git(STUDIO, 'rev-parse', ...['conformance/pack/a.json', 'conformance/barkpark-studio.json', '.github', 'app'].map((p) => `${main}:${p}`)).split('\n')
  const entry = (mode, name, sha) => Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(sha, 'hex')])
  const tree = (...entries) => execFileSync('git', ['hash-object', '-t', 'tree', '--literally', '-w', '--stdin'], {cwd: STUDIO, env, input: Buffer.concat(entries), encoding: 'utf8'}).trim()
  const pack = tree(entry('100644', '..', a), entry('100644', 'a.json', a))
  const top = tree(entry('40000', '.github', github), entry('40000', 'app', app), entry('40000', 'conformance', tree(entry('100644', 'barkpark-studio.json', report), entry('40000', 'pack', pack))))
  return git(STUDIO, 'commit-tree', top, '-p', main, '-m', 'sync')
}
/** A case's origin: main at `main`, the sync branch at `branch` if given; Barkpark's main as `barkpark` holds it. */
const world = (main = S.main, branch, barkpark = BARKPARK) => ({origin: borrower([STUDIO], {'refs/heads/main': main, ...(branch && {[`refs/heads/${BRANCH}`]: branch})}), barkpark})
const branchAt = (w) => (existsSync(join(w.origin, 'refs/heads', BRANCH)) ? readFileSync(join(w.origin, 'refs/heads', BRANCH), 'utf8').trim() : '')
const moveMain = (w, sha) => write(w.origin, 'refs/heads/main', `${sha}\n`)

/** The plan's folder: plan.json, and given a `head`, the bundle of it (as HEAD) past `not`. */
async function plan(json, head, not = [S.main], lenders = [STUDIO]) {
  const dir = join(tmp('plan-'), 'plan')
  mkdirSync(dir)
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(json))
  if (head) await gitRun(borrower(lenders, {HEAD: head}), ['bundle', 'create', '-q', join(dir, 'sync.bundle'), 'HEAD', ...not.map((c) => `^${c}`)])
  return join(dir, '..')
}

/**
 * The commands every act run starts, written once: a new executable is slow to start the first time on
 * macOS. The key shims, git and gh, and origin's pre-receive hook (core.hooksPath in the template). Each run
 * gives its own folder in the env (ACT_DIR, and KEY_SEEN_LOG for the shims), so a leak is named under the
 * run that made it; a child that lost KEY_SEEN_LOG logs to the shims' fallback, which every run reads too.
 */
const SHARED = tmp('act-bin-')
const shim = keyShims(join(SHARED, 'shims'), KEY, {logFrom: 'KEY_SEEN_LOG'})
const BIN = join(SHARED, 'bin')
const HOOKS = join(SHARED, 'hooks')
const exe = (path, text) => (mkdirSync(join(path, '..'), {recursive: true}), writeFileSync(path, text), chmodSync(path, 0o755))
exe(join(BIN, 'git'), `#!/bin/sh\n${shim.check('git')}\n[ ! -e "$RUNNER_TEMP/deploy-key" ] || echo "$1" >> "\${ACT_DIR:?}/key-while.log"\nexec "${REAL_GIT}" "$@"\n`)
// ACT_PLANT (a folder): gh's first call starts a command with the key in its env, makes `planted` there and
// waits for `go`. ACT_LOSE: gh starts one with the key in its env and KEY_SEEN_LOG gone.
exe(join(BIN, 'gh'), `#!/bin/sh
${shim.check('gh')}
[ -z "$ACT_PLANT" ] || [ -e "$ACT_PLANT/planted" ] || { LEAK='${KEY}' cat < /dev/null; : > "$ACT_PLANT/planted"; while [ ! -e "$ACT_PLANT/go" ]; do sleep 0.02; done; }
[ -z "$ACT_LOSE" ] || env -u KEY_SEEN_LOG LEAK='${KEY}' cat < /dev/null
echo "$*" >> "\${ACT_DIR:?}/calls.log"
case "$1 $2" in
  "pr list") cat "$ACT_DIR/prs.json" ;;
  "pr view") echo MERGED ;;
esac
`)
exe(join(HOOKS, 'pre-receive'), `#!/bin/sh\ncat "$RUNNER_TEMP/deploy-key" >> "\${ACT_DIR:?}/pushed-key.log" 2>/dev/null || echo none >> "$ACT_DIR/pushed-key.log"\n`)
git(TEMPLATE, 'config', 'core.hooksPath', HOOKS)

/**
 * Act's script in a fresh clone of origin (the job's checkout); gh answers `pr list` with `prs`, and every
 * child is checked for the key by the shared shims, logging to this run's own file (key-shims.mjs): PATH
 * holds only those and the shared git and gh. Origin's pre-receive hook logs the key file as a push sees it.
 * `keyWhile`: each git command run while the key file exists; `keyLeft`: key files left in RUNNER_TEMP;
 * `sshCommand`: the checkout's core.sshCommand. `plant` (a folder; outside the slots) and `lose`: see gh.
 */
const act = (w, runnerTemp, prs = [], urgent = false, {plant, lose} = {}) =>
  (plant ? (fn) => fn() : (fn) => slot(fn, urgent))(async () => {
    const dir = tmp('act-')
    const seenLog = join(dir, 'seen.log')
    writeFileSync(join(dir, 'prs.json'), JSON.stringify(prs))
    // --no-local: the checkout holds only what origin's refs reach, never the objects origin borrows.
    const checkout = join(tmp('checkout-'), 'repo')
    await gitRun(base, ['clone', '-q', '--no-local', w.origin, checkout])
    const out = join(dir, 'out')
    const r = await run(BASH, [ACT], {cwd: checkout, env: {...env, PATH: `${BIN}:${shim.dir}`, ACT_DIR: dir, KEY_SEEN_LOG: seenLog, ACT_PLANT: plant ?? '', ACT_LOSE: lose ? '1' : '', RUNNER_TEMP: runnerTemp, GITHUB_OUTPUT: out, BARKPARK_GIT: w.barkpark, DEPLOY_KEY: KEY, DEPLOY_PUSH_URL: w.origin}})
    const seen = shim.seen(seenLog)
    assert.deepEqual(seen, [], `a child process saw the deploy key (${seen.join(', ')}): ${r.stdout + r.stderr}`)
    const lost = shim.seen(shim.fallback)
    assert.deepEqual(lost, [], `a child process saw the deploy key and logged it to no run's own log (${lost.join(', ')}): ${r.stdout + r.stderr}`)
    const lines = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8').trim().split('\n') : [])
    const calls = lines('calls.log')
    const sshCommand = readFileSync(join(checkout, '.git/config'), 'utf8').match(/^\s*sshcommand\s*=\s*(.*)$/im)?.[1] ?? ''
    return {
      status: r.status,
      err: r.stdout + r.stderr,
      writes: calls.filter((c) => !/^pr (list|view)/.test(c)),
      keyWhile: lines('key-while.log'),
      pushedWith: lines('pushed-key.log'),
      temp: runnerTemp,
      body: existsSync(join(runnerTemp, 'sync-body.md')) ? readFileSync(join(runnerTemp, 'sync-body.md'), 'utf8') : '',
      keyLeft: readdirSync(runnerTemp).filter((f) => f.startsWith('deploy-key')),
      sshCommand,
    }
  })
/** Act's commit on the branch: the plan's tree and parents under act's own message. */
function landed(w, planned) {
  const at = branchAt(w)
  assert.equal(git(w.origin, 'rev-parse', `${at}^{tree}`), git(w.origin, 'rev-parse', `${planned}^{tree}`))
  assert.equal(git(w.origin, 'rev-parse', `${at}^@`), git(w.origin, 'rev-parse', `${planned}^@`))
  assert.match(git(w.origin, 'log', '-1', '--format=%s', at), /^PortableDoc pack: sync from Barkpark [0-9a-f]{12}$/)
  return at
}
const syncPr = (number = 9, more = {}) => ({number, headRefName: BRANCH, baseRefName: 'main', isCrossRepository: false, ...more})
/** Every case ([name, its run]) to its end; then each failure, named. */
async function cases(runs) {
  const settled = await Promise.allSettled(runs.map(([, run]) => run))
  const failed = settled.flatMap((s, i) => (s.status === 'rejected' ? [`${runs[i][0]}: ${s.reason?.message ?? s.reason}`] : []))
  if (failed.length) throw new Error(failed.join('\n---\n'))
}

test('the .. fixture holds a tree entry named .. in conformance/pack', () => {
  assert.ok(DOT_DOT_AT >= 0, `no REFUSED row is named ${DOT_DOT}`)
  const at = S[`refused-${DOT_DOT_AT}`]
  assert.deepEqual(git(STUDIO, 'ls-tree', '-z', '--name-only', `${at}:conformance/pack`).split('\0').filter(Boolean), ['..', 'a.json'])
})

test('sync-act.sh handles no key itself: it sources scripts/lib/deploy-push.sh and pushes with deploy_push', () => {
  const code = readFileSync(ACT, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l))
  assert.deepEqual(code.filter((l) => /deploy-push\.sh/.test(l)), ['. "${BASH_SOURCE[0]%/*}/lib/deploy-push.sh"'])
  assert.deepEqual(code.filter((l) => /deploy_push/.test(l)).map((l) => l.trim()), ['deploy_push "$sync:refs/heads/$branch" --force-with-lease="$branch:$lease"', 'deploy_push "$start:refs/heads/$branch" --force-with-lease="$branch:$sync"'])
  assert.deepEqual(code.filter((l) => /DEPLOY_|deploy_key|keyfile/.test(l) || /ssh|git push|\btrap\b/i.test(l)), [], 'nothing else touches the key')

  // Before that line DEPLOY_KEY is still in the env: only what beforeTheHelper allows, nothing that starts a process.
  const bytes = readFileSync(ACT)
  assert.deepEqual(beforeTheHelper(bytes), [])
  assert.deepEqual(beforeTheHelper(withLine(bytes, "y='a[b]'")), [], 'a single-quoted value holds anything')
  for (const [added, named = added] of PRELUDE_BREAKS) assert.deepEqual(beforeTheHelper(withLine(bytes, added)), named.split('\n'), JSON.stringify(added))
})

earlyTest('act pushes a sync commit on main and opens the PR; it refuses to push one that leaves the pack', async () => {
  const pushes = async () => {
    const ok = world()
    const r = await act(ok, await plan({action: 'push', main: S.main}, S.synced))
    assert.equal(r.status, 0, r.err)
    assert.match(r.writes.join('\n'), /^pr create --head sync\/barkpark-pack --base main/m)
    // Act's own commit: the plan's tree on main under act's message; then the empty commit that starts the
    // checks, made without a checkout. The PR's title and body are act's, from the Barkpark commit it checked.
    const at = B.b2
    assert.equal(git(ok.origin, 'rev-parse', `${BRANCH}^^{tree}`), git(ok.origin, 'rev-parse', `${S.synced}^{tree}`))
    assert.equal(git(ok.origin, 'rev-parse', `${BRANCH}^^`), S.main)
    assert.equal(git(ok.origin, 'log', '-1', '--format=%s', `${BRANCH}^`), `PortableDoc pack: sync from Barkpark ${at.slice(0, 12)}`)
    assert.equal(git(ok.origin, 'log', '-1', '--format=%s', BRANCH), 'Start the checks')
    assert.ok(r.writes.includes(`pr create --head ${BRANCH} --base main --title PortableDoc pack: sync from Barkpark ${at.slice(0, 12)} --body-file ${r.temp}/sync-body.md`), r.writes.join('\n'))
    assert.match(r.body, new RegExp(`^Written by \`scripts/pack-sync\.mjs\` from \\[\`FRIKKern/barkpark\` ${at.slice(0, 12)}\\]\\(https://github\\.com/FRIKKern/barkpark/commit/${at}\\)`))
    // The deploy key: a file only while each push runs, gone after; never in gh's env.
    assert.deepEqual(r.pushedWith, ['the deploy key', 'the deploy key'])
    assert.deepEqual(r.keyWhile.filter((c) => c !== 'receive-pack'), ['push', 'push'], 'the key file exists only while git pushes')
    assert.deepEqual(r.keyLeft, [])
  }
  const refused = async ([name, , needle, o = {}], i) => {
    const main = S[o.main ?? 'main']
    const w = world(main, undefined, o.barkpark)
    const r = await act(w, await plan({action: 'push', main}, S[`refused-${i}`], [main]))
    assert.equal(r.status, 1, `${name}: ${r.err}`)
    assert.match(r.err, needle, name)
    assert.equal(branchAt(w), '', `${name}: nothing pushed`)
    assert.deepEqual(r.writes, [], `${name}: no PR`)
    assert.deepEqual([r.keyWhile, r.pushedWith, r.keyLeft, r.sshCommand], [[], [], [], ''], `${name}: the key never written`)
  }
  // A plan value with a line break stays on the error line.
  const forged = async () => {
    const r = await act(world(), await plan({action: 'push', main: 'x\n::set-output name=merged::true'}, S.synced))
    assert.equal(r.status, 1)
    assert.match(r.err, /^::error::main x%0A::set-output name=merged::true$/m)
    assert.doesNotMatch(r.err, /^::set-output/m)
  }
  await cases([['a push', pushes()], ...REFUSED.map((row, i) => [row[0], refused(row, i)]), ['a forged plan value', forged()]])
})

test("act's Barkpark paths are the sync's: conformance.mjs and its types from Barkpark's conformance/", () => {
  assert.deepEqual(Object.entries(COPIED).filter(([mine, theirs]) => mine !== theirs), [['conformance.mjs', 'conformance/conformance.mjs'], ['conformance.d.mts', 'conformance/conformance.d.mts']])
  assert.match(readFileSync(ACT, 'utf8'), /^ {8}conformance\.mjs \| conformance\.d\.mts\) src=conformance\/\$rel ;;$/m)
})

earlyTest('act finds the sync PR itself: a plan naming another PR is refused for close, land and push', async () => {
  const other = syncPr(1287, {headRefName: 'feat/other'})
  const named = async (json) => {
    const r = await act(world(), await plan(json), [syncPr(9), other])
    assert.equal(r.status, 1, `${json.action} ${json.number}: ${r.err}`)
    assert.match(r.err, /the sync PR is #9/)
    assert.deepEqual(r.writes, [])
  }
  // A fork's PR from a branch of the same name is not the sync PR.
  const fork = async () => {
    const r = await act(world(), await plan({action: 'close', number: '41'}), [syncPr(41, {isCrossRepository: true})])
    assert.equal(r.status, 1, r.err)
    assert.deepEqual(r.writes, [])
  }
  // No sync PR open: close and land do nothing, and the key is never written.
  const none = async (json) => {
    const r = await act(world(), await plan(json), [other])
    assert.equal(r.status, 0, r.err)
    assert.match(r.err, /no sync PR open/)
    assert.deepEqual(r.writes, [])
    assert.deepEqual([r.keyWhile, r.pushedWith, r.keyLeft, r.sshCommand], [[], [], [], ''])
  }
  // The sync PR: closed by its own number only while its head's pack is main's, byte for byte.
  const differs = async () => {
    const r = await act(world(S.main, S.differs), await plan({action: 'close', number: 9}), [syncPr(9)])
    assert.equal(r.status, 1, r.err)
    assert.match(r.err, /#9's pack differs from main's/)
    assert.deepEqual(r.writes, [])
  }
  const closes = async () => {
    const r = await act(world(S.main, S.hand), await plan({action: 'close', number: 9}), [syncPr(9)])
    assert.deepEqual(r.writes, ['pr close 9 --comment main already carries these files: nothing left to sync.'], 'the branch stays')
  }
  // And merged by its own number.
  const lands = async () => {
    const r = await act(world(S.main, S.hand), await plan({action: 'land', number: 9, head: S.main}), [syncPr(9)])
    assert.match(r.writes[0], /^pr merge 9 --squash --delete-branch --match-head-commit [0-9a-f]{40}$/)
  }
  await cases([
    ...[{action: 'close', number: '1287'}, {action: 'land', number: '1287', head: S.main}, {action: 'close', number: '1290'}].map((j) => [`${j.action} #${j.number}`, named(j)]),
    ['a fork', fork()],
    ...[{action: 'close'}, {action: 'land', head: S.main}].map((j) => [`${j.action}, no sync PR`, none(j)]),
    ['close, pack differs', differs()],
    ['close', closes()],
    ['land', lands()],
  ])
})

earlyTest('act, with the sync PR open: the commit sits on its head with main merged in, never straight on main', async () => {
  // The PR's branch (S.hand): a hand commit on main. Straight on main, the hand commit dropped: refused.
  const refusedStraight = async () => {
    const w = world(S.main, S.hand)
    const r = await act(w, await plan({action: 'push', number: 9, main: S.main}, S.straight), [syncPr(9)])
    assert.equal(r.status, 1, r.err)
    assert.match(r.err, /not on #9's head merged with main/)
    assert.equal(branchAt(w), S.hand)
  }
  // No valid bundle: refused before any fetch from it.
  const refusedBundle = async () => {
    const bad = await plan({action: 'push', number: 9, main: S['main-3']})
    writeFileSync(join(bad, 'plan', 'sync.bundle'), 'not a bundle')
    const r = await act(world(S['main-3'], S.hand), bad, [syncPr(9)])
    assert.equal(r.status, 1)
    assert.match(r.err, /no valid sync\.bundle/)
    assert.deepEqual([r.keyWhile, r.pushedWith, r.keyLeft, r.sshCommand], [[], [], [], ''], 'a refused bundle: the key never written')
  }
  const onHead = async () => {
    // On the head, which holds that main already: pushed, the hand commit kept, the PR edited.
    const w = world(S.main, S.hand)
    const ok = await act(w, await plan({action: 'push', number: 9, main: S.main}, S['on-head'], [S.hand]), [syncPr(9)], true)
    assert.equal(ok.status, 0, ok.err)
    const first = landed(w, S['on-head'])
    assert.match(ok.writes[0], /^pr edit 9 --title/)
    // Main moves; the next sync merges it into the head: pushed on top, the hand commit still there.
    moveMain(w, S['main-2'])
    const two = await importLater(STUDIO, [
      {name: 'merge-2', from: first, merge: S['main-2'], files: {'app/x.ts': 'moved\n'}},
      {name: 'planned-2', from: 'merge-2', files: pack('{"v": 4}\n', B.b4)},
    ], w.origin)
    const lenders = [STUDIO, w.origin]
    const ok2 = await act(w, await plan({action: 'push', number: 9, main: S['main-2']}, two['planned-2'], [first, S['main-2']], lenders), [syncPr(9)], true)
    assert.equal(ok2.status, 0, ok2.err)
    const second = landed(w, two['planned-2'])
    assert.equal(git(w.origin, 'merge-base', '--is-ancestor', S.hand, BRANCH), '')
    // A merge carrying one more change than git's own merge: refused.
    moveMain(w, S['main-3'])
    const three = await importLater(STUDIO, [
      {name: 'merge-3', from: second, merge: S['main-3'], files: {'app/x.ts': 'main again\n', 'README.md': 'r\n', 'app/evil.ts': 'x\n'}},
      {name: 'planned-3', from: 'merge-3', files: pack('{"v": 5}\n', B.b5)},
    ], w.origin)
    const r3 = await act(w, await plan({action: 'push', number: 9, main: S['main-3']}, three['planned-3'], [second, S['main-3']], lenders), [syncPr(9)], true)
    assert.equal(r3.status, 1, r3.err)
    assert.match(r3.err, /not on #9's head merged with main/)
    assert.equal(branchAt(w), second)
  }
  await cases([['straight on main', refusedStraight()], ['no valid bundle', refusedBundle()], ['on the head, then main merged in', onHead()]])
})

// Each act run reads its own key-leak log. One shared log, read and cleared by whichever run ended first, named
// a leak under another case, or lost it (task-8b57e3da21dab4b3): here one run leaks while another ends.
earlyTest('a key leak is named under the run that made it, while another run ends, and never lost', async () => {
  const marks = tmp('plant-')
  const close = async () => plan({action: 'close'})
  const planted = act(world(), await close(), [], false, {plant: marks})
  // Polled until the leaking run plants or ends, not after: a loop left running keeps node from exiting.
  let raced = false
  const isPlanted = async () => {
    while (!raced && !existsSync(join(marks, 'planted'))) await new Promise((r) => setTimeout(r, 10))
  }
  await Promise.race([isPlanted(), planted.catch(() => {})])
  raced = true
  assert.ok(existsSync(join(marks, 'planted')), 'the leaking run ended without planting its leak')
  const clean = act(world(), await close()).finally(() => writeFileSync(join(marks, 'go'), ''))
  await assert.rejects(cases([['the leaking run', planted], ['the clean run', clean]]), (e) => {
    assert.match(e.message, /^the leaking run: a child process saw the deploy key \(cat\)/)
    assert.doesNotMatch(e.message, /the clean run/)
    return true
  })
})

// A child whose env lost its run's log name: its leak goes to the shims' fallback log, which every run reads,
// so it is never lost. Last, with every other run ended, so no other run reads it first.
test("a key leak by a child that lost its run's log is still caught", async () => {
  await assert.rejects(act(world(), await plan({action: 'close'}), [], false, {lose: true}), /a child process saw the deploy key and logged it to no run's own log \(cat\)/)
})
