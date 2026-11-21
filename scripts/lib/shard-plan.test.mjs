// No e2e group plans above the line (PLAN_LINE_S, e2e/time-cap.mjs, beside the 60 s cap), with the groups CI runs.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import test from 'node:test'

import {PLAN_LINE_S, plan} from './shard-plan.mjs'

/** The groups CI runs: e2e.yml's studio matrix. */
const yaml = createRequire(new URL('../../app/package.json', import.meta.url))('js-yaml')
const groups = yaml.load(readFileSync(new URL('../../.github/workflows/e2e.yml', import.meta.url), 'utf8'), {schema: yaml.CORE_SCHEMA}).jobs.studio.strategy.matrix.include.length

/** Each group over the line, by name and its planned seconds. Sums of tenths carry float dust (a sum can read 49.00000000000001): not over. */
const over = (p, line = PLAN_LINE_S) => p.groups.flatMap((g, i) => (g.secs - line > 1e-6 ? [`group ${i + 1} plans ${g.secs.toFixed(1)} s`] : []))

test(`no e2e group plans above the line of ${PLAN_LINE_S} s by e2e/durations.json`, () => {
  assert.equal(groups, 7)
  const p = plan(groups)
  const bad = over(p)
  assert.deepEqual(bad, [], `${bad.join('; ')}, over the line of ${PLAN_LINE_S} s (e2e/time-cap.mjs PLAN_LINE_S, beside the 60 s cap). Take time out of the specs in that group (or split a heavy one so the planner can spread it); the line is never raised for this, and the cap and the number of groups do not change for it.${p.unknown.length ? ` Counted as ${p.median} s each, not recorded yet: ${p.unknown.join(', ')}.` : ''}`)
})

test('the check names a group over the line, a new spec counted as unrecorded too', () => {
  const specs = ['a.spec.ts', 'b.spec.ts', 'c.spec.ts', 'new.spec.ts']
  const secs = {'a.spec.ts': 30, 'b.spec.ts': 20, 'c.spec.ts': 10}
  const p = plan(2, secs, specs, () => true)
  assert.deepEqual(p.unknown, ['new.spec.ts'])
  assert.deepEqual(p.groups.map((g) => g.secs), [40, 40], 'the new spec counts as the median, 20 s')
  assert.deepEqual(over(p, 39.9), ['group 1 plans 40.0 s', 'group 2 plans 40.0 s'])
  assert.deepEqual(over(p, 40), [])
})
