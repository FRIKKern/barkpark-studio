// No e2e group plans above the line (scripts/lib/shard-plan.mjs PLAN_LINE_S), with the groups CI runs.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import test from 'node:test'

import {plan, PLAN_LINE_S} from './shard-plan.mjs'

/** The groups CI runs: e2e.yml's studio matrix. */
const yaml = createRequire(new URL('../../app/package.json', import.meta.url))('js-yaml')
const groups = yaml.load(readFileSync(new URL('../../.github/workflows/e2e.yml', import.meta.url), 'utf8'), {schema: yaml.CORE_SCHEMA}).jobs.studio.strategy.matrix.include.length

/** Each group over the line, by name and its planned seconds. */
const over = (p, line = PLAN_LINE_S) => p.groups.flatMap((g, i) => (g.secs > line ? [`group ${i + 1} plans ${g.secs.toFixed(1)} s`] : []))

test(`no e2e group plans above ${PLAN_LINE_S} s by e2e/durations.json`, () => {
  assert.equal(groups, 7)
  const p = plan(groups)
  const bad = over(p)
  assert.deepEqual(bad, [], `${bad.join('; ')}, over the line of ${PLAN_LINE_S} s (scripts/lib/shard-plan.mjs PLAN_LINE_S). A spec that takes a group over it cuts its own time or is split so the planner can spread it; the line is never raised.${p.unknown.length ? ` Counted as ${p.median} s each, not recorded yet: ${p.unknown.join(', ')}.` : ''}`)
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
