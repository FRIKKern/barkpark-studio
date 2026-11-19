// housekeeping.yml's hygiene step that deletes merged branches, its `run` taken from the YAML and run as
// GitHub runs it, against a local bare repo as origin and a stub gh that logs every call.
import assert from 'node:assert/strict'
import {execFileSync, spawnSync} from 'node:child_process'
import {chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test, {after} from 'node:test'
import {fileURLToPath} from 'node:url'

import {load} from './workflow-keys.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const step = load(readFileSync(join(root, '.github/workflows/housekeeping.yml'), 'utf8')).jobs.hygiene.steps.find((s) => s.name === 'Delete merged branches left on the remote')
const base = mkdtempSync(join(tmpdir(), 'hygiene-'))
after(() => rmSync(base, {recursive: true, force: true}))
const env = {...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}
const git = (cwd, ...args) => execFileSync('git', args, {cwd, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']}).trim()

test('hygiene deletes a branch only when a merged PR of this repo has it, by full ref, at that PR head SHA', () => {
  git(base, 'init', '-q', '--bare', '-b', 'main', 'origin.git')
  git(base, 'clone', '-q', 'origin.git', 'work')
  const work = join(base, 'work')
  const empty = execFileSync('git', ['mktree'], {cwd: work, env, input: '', encoding: 'utf8'}).trim()
  const sha = {}
  for (const name of ['main', 'merged', 'reused', 'fork', 'old/x']) {
    sha[name] = git(work, 'commit-tree', empty, '-m', name)
    git(work, 'push', '-q', 'origin', `${sha[name]}:refs/heads/${name}`)
  }
  const pr = (headRefName, headRefOid, isCrossRepository = false) => ({headRefName, headRefOid, isCrossRepository})
  const prs = [
    pr('merged', sha.merged), // its tip: deleted
    pr('reused', sha.main), // the branch has moved on since: kept
    pr('fork', sha.fork, true), // a fork's branch of the same name: kept
    pr('main', sha.main), // main: never
    pr('gone', sha.merged), // no such branch: no call
    pr('x', sha['old/x']), // only old/x ends in /x: no call
  ]
  const bin = join(base, 'bin')
  execFileSync('mkdir', ['-p', bin])
  const log = join(bin, 'gh.log')
  writeFileSync(join(bin, 'prs.json'), JSON.stringify(prs))
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\necho "$*" >> "${log}"\ncase "$1 $2 $3 $4" in\n  "pr list --state merged") while [ "$1" != --jq ]; do shift; done; jq -r "$2" "${join(bin, 'prs.json')}" ;;\nesac\n`)
  chmodSync(join(bin, 'gh'), 0o755)
  const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', step.run], {cwd: work, encoding: 'utf8', env: {...env, PATH: `${bin}:${process.env.PATH}`, GH_REPO: 'o/r'}})
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const calls = readFileSync(log, 'utf8').trim().split('\n').slice(1)
  assert.deepEqual(calls, ['api -X DELETE repos/o/r/git/refs/heads/merged --silent'])
})
