import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test, {after} from 'node:test'
import {fileURLToPath} from 'node:url'

import {PACK_DIR, SOURCE_PATH, compare, ghWrite, selfCheck, sha256, sourceDir} from './pack.mjs'
import {codeAfterKey} from './workflow-keys.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const workflows = join(root, '.github/workflows')
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

test('after a keyed checkout, every workflow runs only the allow-list', () => {
  // housekeeping.yml's refresh job regenerates the roadmap after its keyed checkout: it moves to the same
  // two-job shape in its own PR, which drops this exception.
  const found = readdirSync(workflows).filter((f) => f.endsWith('.yml')).flatMap((f) => codeAfterKey(readFileSync(join(workflows, f), 'utf8')).map((v) => `${f} ${v}`))
  assert.deepEqual(found.filter((v) => !v.startsWith('housekeeping.yml refresh: ')), [])
  assert.ok(readFileSync(join(workflows, 'sync-pack.yml'), 'utf8').includes('ssh-key'), 'the sync pushes with the key')
})

test('the key lint: past a keyed checkout only git, gh, jq, sleep and built-ins run; before it, or with no key, anything', () => {
  const job = (steps) => `name: x\non: push\njobs:\n  act:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`
  const keyed = "      # the key\n      - uses: actions/checkout@v5\n        with: { ssh-key: '${{ secrets.K }}' }\n      # a comment between steps\n"
  const lint = (steps) => codeAfterKey(job(steps)).map((v) => v.split(': ').at(-1))
  assert.deepEqual(lint(`${keyed}      - run: node scripts/x.mjs\n`), ['node'])
  assert.deepEqual(lint(`${keyed}      - name: build\n        run: |\n          git fetch\n          pnpm --dir app install\n`), ['pnpm'])
  assert.deepEqual(lint(`${keyed}      - uses: ./.github/actions/mine\n`), ['uses ./.github/actions/mine'])
  assert.deepEqual(lint(`${keyed}      - uses: actions/github-script@v7\n`), ['uses actions/github-script@v7'])
  assert.deepEqual(lint(`${keyed}      - run: |\n          ./push.sh\n`), ['./push.sh'])
  // Not on any deny-list: an allow-list names them all.
  for (const [line, bad] of [['tsx x.ts', ['tsx']], ['a=$(which node)', ['which']], ['X=1 vitest run', ['vitest']], ['cp a b', ['cp']], ['git log | cat', ['cat']], ['echo `id`', ['!backtick']], ['eval "$x"', ['eval']], ['source ./x', ['source']], ["cat <<EOF\n          x\n          EOF", ['cat', '!heredoc', 'x', 'EOF']], ['"pnpm" i', ['""']]])
    assert.deepEqual(lint(`${keyed}      - run: |\n          ${line}\n`), bad, line)
  // A double-quoted key is a key too.
  assert.deepEqual(lint(`      - uses: actions/checkout@v5\n        with: { ssh-key: "\${{ secrets.K }}" }\n      - run: node x.mjs\n`), ['node'])
  // What the push job writes passes: pipes, $( ), <( ), [[ ]], case patterns, redirections, assignments.
  const ok = [
    'set -euo pipefail',
    'n=$(gh pr list --json number | jq -r \'.[] | .number\')',
    'case "$a" in',
    '  close) [ -n "$n" ] || { echo "none"; exit 0; } ;;',
    '  *) exit 1 ;;',
    'esac',
    'while IFS= read -r -d \'\' m && IFS= read -r -d \'\' p; do',
    '  [[ $m =~ $re && ! $p =~ $re2 ]] || bad+="$p; "',
    'done < <(git diff --raw -z a b)',
    'for try in 1 2 3; do git push origin x && exit 0; sleep $((try * 5)); done',
    'echo "merged=true" >> "$GITHUB_OUTPUT"',
    'read -r _ base <<<"$(git rev-list --parents -n 1 x)"',
    'if ! { [ -f x ] && git bundle verify -q x; }; then echo "::error::no"; exit 1; fi',
  ]
  assert.deepEqual(lint(`${keyed}      - run: |\n${ok.map((l) => `          ${l}\n`).join('')}`), [])
  assert.deepEqual(lint(`      - run: node scripts/x.mjs\n${keyed}      - run: git push origin HEAD:x\n      - uses: actions/download-artifact@v4\n`), [])
  assert.deepEqual(lint(`      - uses: actions/checkout@v5\n      - run: node scripts/x.mjs\n`), [])
  assert.deepEqual(lint(`      - uses: actions/checkout@v5\n        with: { ssh-key: '\${{ secrets.K }}', persist-credentials: false }\n      - run: node x.mjs\n`), [])
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
