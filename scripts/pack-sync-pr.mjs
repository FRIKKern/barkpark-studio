// The daily sync's plan (.github/workflows/sync-pack.yml, job `plan`; docs/decisions/0009-pack-syncs-itself.md).
// It reads GitHub and git and writes nothing to either: every write (push, PR, merge, close) is printed
// as `would:` and left to the workflow's `act` job, which runs no project code.
//
//   a file other than the stamp differs from Barkpark main? ── no ─► an open sync PR is closed; done
//        │ yes                                                       (a stamp-only difference rides along)
//   an open sync PR that carries those files? ── yes ─► every required check green at its head? ─► land it
//        │ no                                              │ one red ─► this run fails, naming it
//        ▼                                                 └ running ─► the next run looks again
//   pack-sync.mjs in a scratch worktree (the PR's branch with main merged in, or main) ─► one commit
//        ─► the act job pushes it to sync/barkpark-pack, opens or updates the PR
//
//   node scripts/pack-sync-pr.mjs <barkpark checkout> --out <dir> [--commit <sha>] [--summary <file>]
// <dir>/plan.json: {action: 'none' | 'close' | 'land' | 'push', number?, head?, lease?, main?, title?}; for a
// push, also sync.bundle (ref HEAD: the sync commit), title.txt and body.md. --commit: as pack-sync.mjs.
import {execFileSync, spawnSync} from 'node:child_process'
import {appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'
import {PACK_DIR, compare, ghWrite, landing, sourceDir} from './lib/pack.mjs'

const BRANCH = 'sync/barkpark-pack'
const BASE = 'main'

const {values, positionals} = parseArgs({allowPositionals: true, options: {out: {type: 'string'}, commit: {type: 'string'}, summary: {type: 'string'}}})
if (positionals.length !== 1 || !values.out) {
  console.error('usage: node scripts/pack-sync-pr.mjs <barkpark checkout> --out <dir> [--commit <sha>] [--summary <file>]')
  process.exit(2)
}
const root = fileURLToPath(new URL('..', import.meta.url))
// Absolute: pack-sync runs in a scratch worktree.
const checkout = resolve(positionals[0])
const src = sourceDir(checkout)
const out = values.out
mkdirSync(out, {recursive: true})
const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']}).trim()
// GitHub, read only: a write never leaves this script (lib/pack.mjs ghWrite names them).
const gh = (...args) => {
  if (ghWrite(args)) throw new Error(`pack-sync-pr: refused a write to GitHub: gh ${args.join(' ')}`)
  return spawnSync('gh', args, {cwd: root, encoding: 'utf8'})
}
const ghOut = (...args) => {
  const r = gh(...args)
  if (r.status !== 0) throw new Error(`gh ${args.join(' ')}: ${r.stderr.trim()}`)
  return r.stdout.trim()
}
const say = (line) => (console.log(line), values.summary && appendFileSync(values.summary, `${line}\n`))
const plan = (p) => {
  writeFileSync(join(out, 'plan.json'), `${JSON.stringify(p, null, 2)}\n`)
  process.exit(0)
}
const fail = (message) => {
  say(`pack-sync-pr: ${message}`)
  process.exit(1)
}

/** What differs from the source, and whether any of it is more than the stamp. */
const differs = (dir) => {
  const lines = compare(dir, src)
  return {lines, real: lines.some((l) => !l.startsWith(`${PACK_DIR}/goldens/stamp.json:`))}
}

// Only this repo's PR: anyone can open a fork PR from a branch of the same name.
const number = ghOut('pr', 'list', '--head', BRANCH, '--base', BASE, '--state', 'open', '--json', 'number,isCrossRepository', '--jq', '.[] | select(.isCrossRepository | not) | .number').split('\n')[0] || undefined
const here = differs(root)
if (here.lines.some((l) => l.startsWith('source '))) fail(`Barkpark's pack is not valid:\n${here.lines.join('\n')}`)

if (!here.real) {
  say(here.lines.length ? `${PACK_DIR}: only the stamp differs from Barkpark; it rides along with the next real change` : `${PACK_DIR}: same as Barkpark`)
  if (!number) plan({action: 'none'})
  say(`would: gh pr close ${number} --delete-branch (main already carries these files)`)
  plan({action: 'close', number})
}

// The open PR's files, read from its branch without checking it out.
if (number) {
  git('fetch', '-q', 'origin', `${BRANCH}:refs/remotes/origin/${BRANCH}`)
  const head = git('rev-parse', `origin/${BRANCH}`)
  const tree = mkdtempSync(join(tmpdir(), 'pack-pr-'))
  execFileSync('sh', ['-c', `git archive "${head}" ${PACK_DIR} | tar -x -C "${tree}"`], {cwd: root})
  if (!differs(tree).real) {
    say(`#${number} already carries these files at ${head.slice(0, 12)}`)
    const required = JSON.parse(ghOut('api', `repos/{owner}/{repo}/rules/branches/${BASE}`, '--jq', '[.[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context]'))
    // gh exits non-zero while checks run or fail: its output alone is read.
    const checks = JSON.parse(gh('pr', 'checks', number, '--json', 'name,bucket,startedAt').stdout || '[]')
    const {verdict, names} = landing(required, checks)
    if (verdict === 'red') fail(`#${number} at ${head.slice(0, 12)}: ${names.join(', ')} failed. The studio renderer is behind Barkpark's pack, or a check needs a rerun.`)
    if (verdict === 'wait') (say(`#${number}: waiting for ${names.join(', ')}`), plan({action: 'none'}))
    say(`would: gh pr merge ${number} --squash --delete-branch --match-head-commit ${head}`)
    plan({action: 'land', number, head})
  }
}

// The sync commit, in a scratch worktree (this checkout is left as it is): on the open PR's branch with
// main merged in, so a hand commit there stays and conformance judges main's renderer; else on main.
git('fetch', '-q', 'origin', BASE)
// The branch's head as this run read it: the push is refused if it moved meanwhile.
const lease = number ? git('rev-parse', `origin/${BRANCH}`) : git('ls-remote', 'origin', `refs/heads/${BRANCH}`).split('\t')[0] || ''
const main = git('rev-parse', `origin/${BASE}`)
const work = join(mkdtempSync(join(tmpdir(), 'pack-tree-')), 'tree')
git('worktree', 'add', '-q', '--detach', work, number ? lease : main)
let title
let refused
try {
  if (existsSync(join(root, 'app/node_modules'))) symlinkSync(join(root, 'app/node_modules'), join(work, 'app/node_modules'))
  const w = (...args) => execFileSync('git', args, {cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']}).trim()
  if (number && spawnSync('git', ['merge', '-q', '--no-edit', main], {cwd: work, stdio: 'inherit'}).status !== 0) {
    spawnSync('git', ['merge', '--abort'], {cwd: work})
    refused = `#${number}: ${BRANCH} does not merge with ${BASE}; close the PR and the next run opens a fresh one`
  }
  const sync = refused ? {status: 1} : spawnSync(process.execPath, ['scripts/pack-sync.mjs', checkout, '--pr-body', join(out, 'body.md'), ...(values.commit ? ['--commit', values.commit] : [])], {cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']})
  if (sync.status === 0) {
    title = sync.stdout.trim().split('\n').at(-1)
    w('add', '-A', '--', PACK_DIR, 'conformance/barkpark-studio.json')
    w('commit', '-q', '-m', title)
    // The commits the branch lacks, as ref HEAD; the act job checks them and pushes HEAD.
    w('bundle', 'create', '-q', join(out, 'sync.bundle'), 'HEAD', `^${main}`, ...(lease ? [`^${lease}`] : []))
  }
} finally {
  git('worktree', 'remove', '--force', work)
  rmSync(join(work, '..'), {recursive: true, force: true})
}
if (!title) fail(refused ?? 'pack-sync failed (see above); nothing to push')
writeFileSync(join(out, 'title.txt'), `${title}\n`)
say(`would: git push --force-with-lease=${BRANCH}:${lease} origin sync:refs/heads/${BRANCH}`)
say(number ? `would: gh pr edit ${number} --title "${title}"` : `would: gh pr create --head ${BRANCH} --base ${BASE} --title "${title}"`)
plan({action: 'push', number, lease, main, title})
