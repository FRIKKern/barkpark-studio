import {test} from 'node:test'
import assert from 'node:assert/strict'
import {latestOnly, runCustomRules, withTimeout, type CustomRule} from './custom-rules.ts'

const doc = {_id: 'p', _type: 'post', featured: true, seo: {metaTitle: 'Same', metaDescription: 'Same'}} as never
const title = (p: string) => p || 'Post'

// Sanity's Rule.custom from the studio config: answers now or later, a throw is an error with its
// message, the context's parent is the object holding the field.
test('custom rules: at once, as a Promise, a throw, and the parent', async () => {
  const rules: CustomRule[] = [
    {validate: (d) => ((d as {featured?: boolean}).featured && !(d as {excerpt?: string}).excerpt ? 'A featured post needs an excerpt' : true)},
    {path: 'seo.metaTitle', level: 'warning', validate: (v, ctx) => (v === (ctx.parent as {metaDescription?: string}).metaDescription ? 'Meta title and description should differ' : true)},
    {path: 'title', validate: () => { throw new Error('boom') }},
    {path: 'featuredNote', validate: async () => 'Later'},
    {path: 'featuredNote', validate: () => Promise.reject(new Error('rejected'))},
  ]
  const {now, later} = runCustomRules(rules, doc, title)
  assert.deepEqual(now.map((p) => [p.path, p.level, p.message]), [
    ['', 'error', 'A featured post needs an excerpt'],
    ['seo.metaTitle', 'warning', 'Meta title and description should differ'],
    ['title', 'error', 'boom'],
  ])
  assert.deepEqual((await later)!.map((p) => [p.path, p.level, p.message]), [['featuredNote', 'error', 'Later'], ['featuredNote', 'error', 'rejected']])
})

// A Promise that never settles fails after the timeout, so Publish never waits on it forever;
// and only the latest run's answer counts.
test('custom rules: a stuck Promise times out; a stale run is dropped', async () => {
  const {later} = runCustomRules([{path: 'x', validate: () => new Promise(() => {})}], doc, title, 20)
  assert.deepEqual((await later)!.map((p) => p.message), ['Validation timed out'])
  await assert.rejects(withTimeout(new Promise(() => {}), 10), /Validation timed out/)
  const runs = latestOnly()
  const a = runs.next()
  const b = runs.next()
  assert.equal(runs.current(a), false)
  assert.equal(runs.current(b), true)
})
