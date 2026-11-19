import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test, {after} from 'node:test'
import {fileURLToPath} from 'node:url'

import {PACK_DIR, SOURCE_PATH, compare, ghWrite, selfCheck, sha256, sourceDir} from './pack.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
// Every temporary folder a test makes, gone after the run.
const made = []
const tmp = (prefix) => (made.push(mkdtempSync(join(tmpdir(), prefix))), made.at(-1))
after(() => made.forEach((d) => rmSync(d, {recursive: true, force: true})))

test('ghWrite: reads pass; every PR write, a non-GET API call and anything else is a write', () => {
  for (const read of [['pr', 'list', '--head', 'x'], ['pr', 'view', '7'], ['pr', 'checks', '7', '--json', 'name'], ['api', 'repos/{owner}/{repo}/rules/branches/main', '--jq', '.'], ['api', '-X', 'GET', 'x']])
    assert.equal(ghWrite(read), false, read.join(' '))
  for (const write of [['pr', 'create'], ['pr', 'edit', '7'], ['pr', 'merge', '7'], ['pr', 'close', '7'], ['pr', 'comment', '7'], ['api', '-X', 'POST', 'x'], ['api', '--method=PATCH', 'x'], ['api', 'x', '-f', 'a=b'], ['workflow', 'run', 'e2e.yml'], ['repo', 'delete']])
    assert.equal(ghWrite(write), true, write.join(' '))
})

// The plan with a stub gh on PATH that logs every call: it writes nothing to GitHub.
function stubGh(open) {
  const bin = tmp('stub-gh-')
  const log = join(bin, 'calls.log')
  writeFileSync(
    join(bin, 'gh'),
    `#!/bin/sh\necho "$*" >> "${log}"\ncase "$1 $2" in\n  "pr list") echo "${open ?? ''}" ;;\n  *) exit 0 ;;\nesac\n`,
  )
  chmodSync(join(bin, 'gh'), 0o755)
  return {bin, calls: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [])}
}
/** A Barkpark checkout holding the studio's own pack, its stamp naming only the block goldens (so only the stamp differs). */
function sourceLikeStudio() {
  const checkout = tmp('pack-source-')
  const src = join(checkout, SOURCE_PATH)
  const pack = join(root, PACK_DIR)
  cpSync(join(pack, 'goldens/blocks'), join(src, 'goldens/blocks'), {recursive: true})
  mkdirSync(join(src, 'conformance'), {recursive: true})
  for (const f of ['conformance.mjs', 'conformance.d.mts']) cpSync(join(pack, f), join(src, 'conformance', f))
  const files = Object.fromEntries(readdirSync(join(src, 'goldens/blocks')).map((f) => [`blocks/${f}`, sha256(readFileSync(join(src, 'goldens/blocks', f)))]))
  writeFileSync(join(src, 'goldens/stamp.json'), JSON.stringify({files}, null, 2))
  return checkout
}
const planWith = (gh, checkout) => {
  const out = tmp('plan-')
  const r = spawnSync(process.execPath, ['scripts/pack-sync-pr.mjs', checkout, '--out', out], {cwd: root, encoding: 'utf8', env: {...process.env, PATH: `${gh.bin}:${process.env.PATH}`}})
  return {status: r.status, stdout: r.stdout, plan: existsSync(join(out, 'plan.json')) ? JSON.parse(readFileSync(join(out, 'plan.json'), 'utf8')) : undefined}
}

test('the plan (dry) writes nothing to GitHub: only the stamp differs, no open PR: nothing to do', () => {
  const gh = stubGh()
  const checkout = sourceLikeStudio()
  assert.deepEqual(compare(root, sourceDir(checkout)), [`${PACK_DIR}/goldens/stamp.json: changed in Barkpark`])
  assert.deepEqual(selfCheck(root), [], 'the self-check holds with the stamp behind and the files equal')
  const r = planWith(gh, checkout)
  assert.equal(r.status, 0, r.stdout)
  assert.deepEqual(r.plan, {action: 'none'})
  assert.match(r.stdout, /only the stamp differs from Barkpark; it rides along/)
  assert.deepEqual(gh.calls().filter((c) => ghWrite(c.split(' '))), [])
  assert.match(gh.calls()[0], /^pr list --head sync\/barkpark-pack/)
})

test('the plan (dry) writes nothing to GitHub: a leftover sync PR is planned closed, printed as would:', () => {
  const gh = stubGh('41')
  const r = planWith(gh, sourceLikeStudio())
  assert.equal(r.status, 0, r.stdout)
  assert.deepEqual(r.plan, {action: 'close', number: '41'})
  assert.match(r.stdout, /^would: gh pr close 41/m)
  assert.deepEqual(gh.calls().filter((c) => ghWrite(c.split(' '))), [])
})

test('the plan reaches gh only through its read-only wrapper', () => {
  const text = readFileSync(join(root, 'scripts/pack-sync-pr.mjs'), 'utf8')
  assert.equal(text.match(/spawnSync\('gh'|execFileSync\('gh'/g)?.length, 1, 'one call site, inside gh()')
  assert.match(text, /const gh = \(\.\.\.args\) => \{\n {2}if \(ghWrite\(args\)\) throw/)
  assert.doesNotMatch(text, /\b(git|w)\('push'/, 'no git push')
})

test('the self-check skips an uncommitted file git ignores, and counts every other file', () => {
  const repo = tmp('pack-git-')
  cpSync(join(root, PACK_DIR), join(repo, PACK_DIR), {recursive: true})
  writeFileSync(join(repo, '.gitignore'), '.DS_Store\n')
  const git = (...args) => assert.equal(spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {cwd: repo}).status, 0, args.join(' '))
  git('init', '-q')
  git('add', '-A')
  git('commit', '-q', '-m', 'pack')
  assert.deepEqual(selfCheck(repo), [])
  writeFileSync(join(repo, PACK_DIR, 'goldens/.DS_Store'), 'finder')
  assert.deepEqual(selfCheck(repo), [], 'an ignored, uncommitted .DS_Store')
  writeFileSync(join(repo, PACK_DIR, 'stray.json'), '{}')
  assert.deepEqual(selfCheck(repo), [`${PACK_DIR}/stray.json: not named by the stamp or SOURCE.md`], 'an untracked file git does not ignore')
  git('add', '-f', `${PACK_DIR}/goldens/.DS_Store`)
  git('commit', '-q', '-m', 'commit an ignored file')
  assert.ok(selfCheck(repo).includes(`${PACK_DIR}/goldens/.DS_Store: not named by the stamp or SOURCE.md`), 'a committed file counts, ignored or not')
})
