// The hourly sync's one step (.github/workflows/sync-pack.yml; docs/decisions/0009-pack-syncs-itself.md):
//
//   main's pack same as Barkpark? ── yes ─► close a leftover sync PR, done
//        │ no
//   an open sync PR? ── yes ─► its branch, main merged in ── carries this pack? ── yes ─► land it
//        │ no                                                   │ no
//   a branch from main ◄────────────────────────────────────────┘
//        ▼
//   pack-sync.mjs ─► commit ─► push (deploy key: starts the checks) ─► open or update the PR
//
// Land: every required check green at the PR's head ─► squash-merge by number at that head, then
// ask again that it is MERGED. A failed check fails this run (the alarm: the studio renderer is
// behind Barkpark); checks still running wait for the next run.
//   node scripts/pack-sync-pr.mjs <barkpark checkout> [--dry-run] [--commit <sha>]   (--commit: as pack-sync.mjs)
// --dry-run: reads GitHub as the run would and prints each write to it (push, PR, merge, close) instead.
// It still switches and commits in this checkout: run it in a scratch clone, never in a working one.
import {execFileSync, spawnSync} from 'node:child_process'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'
import {PACK_DIR, compare, landing, sourceDir} from './lib/pack.mjs'

const BRANCH = 'sync/barkpark-pack'
const BASE = 'main'
const MERGE_TRIES = 5
const WAIT_MS = Number(process.env.SYNC_PR_WAIT_MS ?? 5000)

const {values, positionals} = parseArgs({allowPositionals: true, options: {'dry-run': {type: 'boolean', default: false}, commit: {type: 'string'}}})
if (positionals.length !== 1) {
  console.error('usage: node scripts/pack-sync-pr.mjs <barkpark checkout> [--dry-run] [--commit <sha>]')
  process.exit(2)
}
const dry = values['dry-run']
const root = fileURLToPath(new URL('..', import.meta.url))
const checkout = positionals[0]
const run = (cmd, ...args) => execFileSync(cmd, args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']}).trim()
const write = (cmd, ...args) => (dry ? (console.log(`dry-run: ${cmd} ${args.join(' ')}`), '') : run(cmd, ...args))
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const fail = (message) => {
  console.error(`pack-sync-pr: ${message}`)
  process.exit(1)
}

// Only this repo's PR: anyone can open a fork PR from a branch of the same name.
const openPr = () => run('gh', 'pr', 'list', '--head', BRANCH, '--base', BASE, '--state', 'open', '--json', 'number,isCrossRepository', '--jq', '.[] | select(.isCrossRepository | not) | .number').split('\n')[0] || undefined

/** Every required check green at `head` ─► merge by number at `head`. Red ─► fail the run. */
function land(number) {
  const head = run('gh', 'pr', 'view', number, '--json', 'headRefOid', '--jq', '.headRefOid')
  // What main's ruleset requires, by name; gh exits non-zero while checks run or fail, so read its output alone.
  const required = JSON.parse(run('gh', 'api', `repos/{owner}/{repo}/rules/branches/${BASE}`, '--jq', '[.[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context]'))
  const checks = JSON.parse(spawnSync('gh', ['pr', 'checks', number, '--json', 'name,bucket,startedAt'], {cwd: root, encoding: 'utf8'}).stdout || '[]')
  const {verdict, names} = landing(required, checks)
  if (verdict === 'red') fail(`#${number} at ${head.slice(0, 12)}: ${names.join(', ')} failed. The studio renderer is behind Barkpark's pack, or a check needs a rerun; the PR waits.`)
  if (verdict === 'wait') return console.log(`#${number}: waiting at ${head.slice(0, 12)} for ${names.join(', ')}; a later run lands it`)
  for (let attempt = 1; attempt <= MERGE_TRIES; attempt++) {
    // By number at the head the checks passed on: gh exits 0 on a PR merged long ago, 1 when only its cleanup failed.
    if (dry) return console.log(`dry-run: gh pr merge ${number} --squash --delete-branch --match-head-commit ${head}`)
    spawnSync('gh', ['pr', 'merge', number, '--squash', '--delete-branch', '--match-head-commit', head], {cwd: root, stdio: ['ignore', 'inherit', 'inherit']})
    if (run('gh', 'pr', 'view', number, '--json', 'state', '--jq', '.state') === 'MERGED') return console.log(`merged #${number} at ${head.slice(0, 12)}`)
    if (attempt < MERGE_TRIES) sleep(attempt * WAIT_MS)
  }
  fail(`#${number} is not merged after ${MERGE_TRIES} tries`)
}

const same = () => compare(root, sourceDir(checkout)).length === 0
const number = openPr()

if (same()) {
  if (number) write('gh', 'pr', 'close', number, '--delete-branch', '--comment', `main already carries this pack (${PACK_DIR} same as Barkpark main).`)
  console.log(`${PACK_DIR}: same as Barkpark, nothing to do${number ? `; closed #${number}` : ''}`)
  process.exit(0)
}

run('git', 'fetch', '-q', 'origin', BASE)
if (number) {
  run('git', 'fetch', '-q', 'origin', BRANCH)
  run('git', 'switch', '-q', '-C', BRANCH, `origin/${BRANCH}`)
  // main merged in, so the restamp below judges main's renderer, as the PR's checks will.
  if (spawnSync('git', ['merge', '-q', '--no-edit', `origin/${BASE}`], {cwd: root, stdio: 'inherit'}).status !== 0) fail(`#${number}: ${BRANCH} does not merge with ${BASE}; close the PR and the next run opens a fresh one`)
  if (same()) {
    console.log(`#${number} already carries this pack: no push, its head holds still`)
    land(number)
    process.exit(0)
  }
} else run('git', 'switch', '-q', '-C', BRANCH, `origin/${BASE}`)

const tmp = mkdtempSync(join(tmpdir(), 'pack-sync-'))
const sync = spawnSync(process.execPath, ['scripts/pack-sync.mjs', checkout, '--pr-body', join(tmp, 'body.md'), ...(values.commit ? ['--commit', values.commit] : [])], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']})
if (sync.status !== 0) fail('pack-sync failed (see above); nothing pushed')
const title = sync.stdout.trim().split('\n').at(-1)
run('git', 'add', '-A', '--', PACK_DIR, 'conformance/barkpark-studio.json')
run('git', 'commit', '-q', '-m', title)
// Pushed with the deploy key (the checkout's): a push by the workflow's own token starts no checks.
// Over the open PR's head only as fetched (someone's push meanwhile refuses this one); a branch
// left by a closed PR is replaced.
write('git', 'push', '-q', number ? `--force-with-lease=${BRANCH}:${run('git', 'rev-parse', `origin/${BRANCH}`)}` : '--force', 'origin', `HEAD:${BRANCH}`)
if (number) {
  write('gh', 'pr', 'edit', number, '--title', title, '--body-file', join(tmp, 'body.md'))
  console.log(`updated #${number}: ${title}`)
} else {
  const made = spawnSync('gh', ['pr', 'create', '--head', BRANCH, '--base', BASE, '--title', title, '--body-file', join(tmp, 'body.md')], {cwd: root, encoding: 'utf8'})
  if (dry) console.log(`dry-run: gh pr create --head ${BRANCH} --base ${BASE} --title ${title}`)
  else if (made.status !== 0)
    fail(`${made.stderr.trim()}\nThe sync PR cannot be opened. If GitHub says Actions may not create pull requests: Settings > Actions > General > "Allow GitHub Actions to create and approve pull requests" must be on.`)
  else {
    console.log(`opened ${made.stdout.trim()}: ${title}`)
    // A PR the workflow's token opens starts no checks; a push by the deploy key does.
    run('git', 'commit', '-q', '--allow-empty', '-m', 'Start the checks: a PR opened by the workflow token starts none')
    write('git', 'push', '-q', 'origin', `HEAD:${BRANCH}`)
  }
}
