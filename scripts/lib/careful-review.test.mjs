// The careful-review list in docs/decisions/0010 is every pinned file and every guard, and nothing else
// (scripts/lib/careful-review.mjs).
import assert from 'node:assert/strict'
import test from 'node:test'

import {carefulGaps, DOC, guards, listed, pinned, repoCareful} from './careful-review.mjs'

const repo = repoCareful()
const gaps = (change) => carefulGaps({...repo, ...change})

test('the careful-review list is every pinned file and every guard, and each listed file is one of them', () => {
  assert.deepEqual(gaps({}), [])
  for (const p of ['scripts/sync-act.sh', 'scripts/lib/keyed-jobs.json', 'scripts/lib/keyed-jobs.test.mjs', 'scripts/lib/workflow-keys.mjs', '.github/workflows/sync-pack.yml', 'scripts/lib/careful-review.test.mjs'])
    assert.ok(repo.list.includes(p), p)
})

test('a pinned file or a guard missing from the list is red', () => {
  const without = (p) => repo.list.filter((x) => x !== p)
  assert.deepEqual(gaps({list: without('scripts/sync-act.sh')}), [`scripts/sync-act.sh: pinned, but not on the careful-review list in ${DOC}`])
  assert.deepEqual(gaps({list: without('scripts/lib/key-shims.mjs')}), [`scripts/lib/key-shims.mjs: a guard, but not on the careful-review list in ${DOC}`])
  // A file newly pinned to a keyed job, or a new module importing a guard: red until it is listed.
  assert.deepEqual(gaps({pinnedFiles: [...repo.pinnedFiles, 'scripts/lib/new-push.sh']}), [`scripts/lib/new-push.sh: pinned, but not on the careful-review list in ${DOC}`])
  const g = guards({'scripts/lib/a.mjs': "import {keyShims} from './key-shims.mjs'\n", 'scripts/b.mjs': "const a = await import('./lib/a.mjs')\n", 'scripts/lib/c.mjs': "import x from './pack.mjs'\n"})
  assert.deepEqual(g.sort(), ['scripts/b.mjs', 'scripts/lib/a.mjs', 'scripts/lib/key-shims.mjs', 'scripts/lib/workflow-keys.mjs'], 'a guard by import, also at one remove')
})

test('a listed file that is gone, or neither pinned nor a guard, is red', () => {
  assert.deepEqual(gaps({list: [...repo.list, 'scripts/lib/gone.sh']}), ['scripts/lib/gone.sh: on the careful-review list, but gone'])
  assert.deepEqual(gaps({list: [...repo.list, 'scripts/lib/pack.mjs']}), ['scripts/lib/pack.mjs: on the careful-review list, but neither pinned nor a guard'])
  // A job's pin dropped: its workflow and the files only it ran are no longer pinned.
  const pins = {jobs: [{job: 'sync-pack.yml act', runs: {'scripts/sync-act.sh': '', 'scripts/lib/deploy-push.sh': ''}}]}
  assert.deepEqual(gaps({pinnedFiles: pinned(pins)}).sort(), ['.github/workflows/housekeeping.yml', 'scripts/check-docs.mjs', 'scripts/housekeeping-push.sh', 'scripts/lib/roadmap-style.css', 'scripts/lib/svg-check.py']
    .map((p) => `${p}: on the careful-review list, but neither pinned nor a guard`))
})

test("the list is read from the doc's bullet alone: a folder holds the names after it", () => {
  const doc = 'x `not/this.md`\n- **Careful review** for it:\n  `a/` `b.sh` `c.mjs`; `d/e/` `f.json`.\n- `outside.md` next\n'
  assert.deepEqual(listed(doc), ['a/b.sh', 'a/c.mjs', 'd/e/f.json'])
  assert.deepEqual(listed('no list\n'), [])
})
