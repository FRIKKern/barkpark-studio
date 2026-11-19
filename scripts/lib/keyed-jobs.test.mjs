// Every workflow job holds no key or is pinned whole with the files it runs (scripts/lib/workflow-keys.mjs).
import assert from 'node:assert/strict'
import test from 'node:test'

import {DATA_SECRETS, jobHash, keyProblems, keyReasons, load, repo} from './workflow-keys.mjs'

const {files, pins, read} = repo()
/** The problems with one workflow's text changed, or a repo file's bytes changed. */
const withEdit = (file, edit, readEdit = read) => keyProblems({...files, [file]: edit(files[file])}, pins, readEdit)
const after = (text, anchor, insert) => {
  assert.ok(text.includes(anchor), anchor)
  return text.replace(anchor, anchor + insert)
}
const ACT_SCRIPT_STEP = '      # The deploy key, for the push alone: a push by the workflow token starts no checks on the PR.\n'
const UNIT_CHECKOUT = '      - uses: actions/checkout@v5\n        with: { persist-credentials: false }\n'

test('every job in .github/workflows holds no key or matches its pin, and every keyed job is pinned', () => {
  assert.deepEqual(keyProblems(files, pins, read), [])
  assert.deepEqual(pins.jobs.map((p) => p.job), ['housekeeping.yml hygiene', 'housekeeping.yml push', 'sync-pack.yml act', 'sync-pack.yml checks-on-main'])
  assert.deepEqual(Object.keys(pins.jobs.find((p) => p.job === 'sync-pack.yml act').runs), ['scripts/sync-act.sh', 'scripts/lib/deploy-push.sh'])
  assert.deepEqual(Object.keys(pins.jobs.find((p) => p.job === 'housekeeping.yml push').runs), ['scripts/housekeeping-push.sh', 'scripts/lib/deploy-push.sh', 'scripts/lib/svg-check.py'])
  // The jobs that run the roadmap generator and the pack sync hold no key.
  for (const [file, job] of [['housekeeping.yml', 'refresh'], ['sync-pack.yml', 'plan']]) assert.deepEqual(keyReasons(load(files[file]), load(files[file]).jobs[job]), [], `${file} ${job}`)
  assert.deepEqual(Object.keys(DATA_SECRETS), ['BARKPARK_TOKEN'])
})

test('a keyed job changed in any way is red until its pin changes too', () => {
  const act = (insert) => withEdit('sync-pack.yml', (t) => after(t, ACT_SCRIPT_STEP, insert))
  const changed = /^sync-pack\.yml act: changed since its pin/
  for (const [name, step] of [
    ['a pnpm install step', '      - run: pnpm --dir app install\n'],
    ['a step with shell:', '      - shell: node {0}\n        run: x\n'],
    ['a step with BASH_ENV', '      - env: { BASH_ENV: ./x.sh }\n        run: git status\n'],
    ['a one-line braces step', '      - { run: node x }\n'],
    ['a quoted "run" key', '      - "run": node x\n'],
  ]) {
    const out = act(step)
    assert.equal(out.length, 1, `${name}: ${out}`)
    assert.match(out[0], changed, name)
  }
  // Housekeeping's keyed push job too.
  const hk = withEdit('housekeeping.yml', (t) => after(t, '        run: bash scripts/housekeeping-push.sh\n', '      - run: pnpm --dir app install\n'))
  assert.deepEqual(hk.map((v) => v.replace(/ \(now .*/, '')), ['housekeeping.yml push: changed since its pin'])
  // So is a workflow-level default the keyed job inherits.
  assert.match(withEdit('sync-pack.yml', (t) => t.replace('permissions: {}\n', 'permissions: {}\ndefaults:\n  run:\n    shell: node {0}\n')).join('\n'), changed)
})

test("a keyed job's actions are named by full commit SHA", () => {
  const out = withEdit('sync-pack.yml', (t) => t.replace(/actions\/download-artifact@[0-9a-f]{40}/, 'actions/download-artifact@v4'))
  assert.ok(out.includes('sync-pack.yml act: uses actions/download-artifact@v4, not a full commit SHA'), String(out))
})

test('the pin reads YAML as GitHub does: dates stay text, and .inf and .nan are refused, never hashed alike', () => {
  const act = (value) => {
    try {
      return jobHash(load(after(files['sync-pack.yml'], ACT_SCRIPT_STEP, `      - env: { SINCE: ${value} }\n        run: x\n`)), 'act')
    } catch (e) {
      return `refused: ${e.message}`
    }
  }
  const got = ['2026-01-01', '2027-12-31', '2001-12-14t21:59:43.10-05:00', '.inf', '.nan', '~', "''"].map(act)
  assert.equal(new Set(got).size, got.length, got.join('\n'))
  assert.match(got[3], /^refused: .*SINCE is Infinity/)
  assert.match(got[4], /^refused: .*SINCE is NaN/)
  assert.match(keyProblems({...files, 'sync-pack.yml': after(files['sync-pack.yml'], ACT_SCRIPT_STEP, '      - env: { SINCE: .inf }\n        run: x\n')}, pins, read).join('\n'), /^sync-pack\.yml act: .*SINCE is Infinity, which this reader refuses$/m)
})

test('one byte changed in a file a keyed job runs is red', () => {
  const byte = (file) => keyProblems(files, pins, (path) => (path === file ? Buffer.concat([read(path), Buffer.from(' ')]) : read(path))).map((v) => v.replace(/ \(now .*/, ''))
  assert.deepEqual(byte('scripts/sync-act.sh'), ['sync-pack.yml act: scripts/sync-act.sh changed since its pin'])
  // The deploy-key helper both pushing jobs source: red in both pins.
  assert.deepEqual(byte('scripts/lib/deploy-push.sh').sort(), ['housekeeping.yml push: scripts/lib/deploy-push.sh changed since its pin', 'sync-pack.yml act: scripts/lib/deploy-push.sh changed since its pin'])
})

test('a job that does not hold "no key" and is not pinned is named', () => {
  const unpinned = (name, edit) => {
    const out = edit()
    assert.equal(out.length, 1, `${name}: ${out}`)
    assert.match(out[0], /^unit\.yml unit: holds a key \(.*\) and is not pinned/, name)
    return out[0]
  }
  // persist-credentials: false only in a comment is no opt-out.
  const comment = unpinned('comment', () => withEdit('unit.yml', (t) => t.replace(UNIT_CHECKOUT, '      - uses: actions/checkout@v5 # persist-credentials: false\n')))
  assert.match(comment, /checks out without persist-credentials: false/)
  unpinned('the string "false"', () => withEdit('unit.yml', (t) => t.replace('{ persist-credentials: false }', "{ persist-credentials: 'false' }")))
  // A secret not on the data-only list, however written.
  for (const ref of ['${{ secrets.NPM_TOKEN }}', "${{ secrets['NPM_TOKEN'] }}", '${{ toJSON(secrets) }}', '${{ SECRETS.npm_token }}'])
    assert.match(unpinned(ref, () => withEdit('unit.yml', (t) => after(t, UNIT_CHECKOUT, `      - env: { T: "${ref}" }\n        run: x\n`))), /reads secret (NPM_TOKEN|\?)/)
  // A secret written as a mapping key (GitHub evaluates `${{ }}` there too): at the step, the job and the workflow.
  const asKey = "'${{ secrets.HOUSEKEEPING_DEPLOY_KEY }}': x"
  assert.match(unpinned('step env key', () => withEdit('unit.yml', (t) => after(t, UNIT_CHECKOUT, `      - env: { ${asKey} }\n        run: pnpm install\n`))), /reads secret HOUSEKEEPING_DEPLOY_KEY/)
  assert.match(unpinned('job env key', () => withEdit('unit.yml', (t) => t.replace(/( {2}unit:\n)/, `$1    env: { ${asKey} }\n`))), /reads secret HOUSEKEEPING_DEPLOY_KEY/)
  assert.match(unpinned('workflow env key', () => withEdit('unit.yml', (t) => t.replace('jobs:\n', `env: { ${asKey} }\njobs:\n`))), /reads secret HOUSEKEEPING_DEPLOY_KEY/)
  assert.match(unpinned('with key', () => withEdit('unit.yml', (t) => after(t, UNIT_CHECKOUT, "      - uses: x/y@v1\n        with: { 'k${{ toJSON(secrets) }}': x }\n"))), /reads secret \?/)
  // A token that may write.
  assert.match(unpinned('contents: write', () => withEdit('unit.yml', (t) => t.replace(/( {2}unit:\n)/, '$1    permissions: { contents: write }\n'))), /its token may write/)
  // A new job: named the same way.
  const fresh = withEdit('docs.yml', (t) => `${t}  leak:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "\${{ secrets.HOUSEKEEPING_DEPLOY_KEY }}"\n`)
  assert.deepEqual(fresh.map((v) => v.replace(/ \(.*\)/, '')), ['docs.yml leak: holds a key and is not pinned in scripts/lib/keyed-jobs.json'])
})

test('holding no key, read from the parsed YAML', () => {
  const wf = {permissions: {contents: 'read'}}
  const job = (more) => ({'runs-on': 'x', steps: [{uses: 'actions/checkout@v5', with: {'persist-credentials': false}}, {run: 'node x'}], ...more})
  assert.deepEqual(keyReasons(wf, job()), [], 'a read-only job may run anything')
  assert.deepEqual(keyReasons(wf, job({env: {T: '${{ secrets.BARKPARK_TOKEN }}'}})), [], 'a data-only secret')
  assert.deepEqual(keyReasons(wf, job({steps: [{name: '.env from secrets', run: 'x'}]})), [], 'the word in a name is no secret')
  assert.deepEqual(keyReasons({}, job()), ['its token may write (permissions: "the repo default")'])
  assert.deepEqual(keyReasons(wf, job({uses: './.github/workflows/x.yml', secrets: 'inherit'})), ['calls ./.github/workflows/x.yml'])
  assert.deepEqual(keyReasons({...wf, env: {K: '${{ secrets.K }}'}}, job()), ['reads secret K'], "the workflow's env")
  assert.deepEqual(keyReasons(wf, job({steps: [{uses: 'actions/checkout@v5', with: {'ssh-key': '${{ env.K }}', 'persist-credentials': false}}]})), [], 'no secret read: env.K is set where it is read')
  assert.deepEqual(keyProblems({'x.yml': 'jobs:\n  a: [\n'}, {jobs: []}, read).map((v) => v.replace(/ \(.*/s, '')), ['x.yml: not parsed'])
})
