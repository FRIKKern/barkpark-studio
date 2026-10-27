import {test} from 'node:test'
import assert from 'node:assert/strict'
import {describeField, latestOnly, runCustomRules, startRun, visibleProblems, withTimeout, type CustomRule} from './custom-rules.ts'
import type {Schema} from './data.ts'

const doc = {_id: 'p', _type: 'post', featured: true, seo: {metaTitle: 'Same', metaDescription: 'Same'}} as never
const title = (p: string) => ({title: p || 'Post'})

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

// task-79f70acdb29bc226: a custom rule's problem is described as a schema one is, so the group
// tab it sits in is marked (Sanity marks Meta for featuredNote's rule) and the panel names the
// object it is in ("SEO / Meta title"). A document rule is in no group and has no parents.
test('custom rules: a problem carries its field group and parent titles', async () => {
  const schema = {name: 'post', title: 'Post', fields: [
    {name: 'featuredNote', title: 'Featured note', type: 'string', group: 'meta'},
    {name: 'seo', title: 'SEO', type: 'object', group: 'meta', fields: [{name: 'metaTitle', title: 'Meta title', type: 'string'}]},
  ]} as unknown as Schema
  const rules: CustomRule[] = [
    {validate: () => 'Document'},
    {path: 'seo.metaTitle', level: 'warning', validate: () => 'Nested'},
    {path: 'featuredNote', validate: async () => 'Later'},
  ]
  const {now, later} = runCustomRules(rules, doc, describeField(schema))
  const shape = ({title, parents, group}: {title: string; parents?: string[]; group?: string}) => ({title, parents, group})
  assert.deepEqual(now.map(shape), [{title: 'Post', parents: undefined, group: undefined}, {title: 'Meta title', parents: ['SEO'], group: 'meta'}])
  assert.deepEqual((await later)!.map(shape), [{title: 'Featured note', parents: undefined, group: 'meta'}])
})

// task-4090c58c3d43fe67: as Sanity's, an edit keeps the last Promise answers on screen until the
// next run's come, so the panel never says "No validation errors" mid-check; another document,
// or a run with no Promise out, starts clean.
test('custom rules: the last async answers stay until the next run answers', () => {
  const err = {path: 'featuredNote', title: 'Featured note', message: 'Remove the TODO', level: 'error' as const}
  const answered = {id: 'a', key: 'k1', now: [], later: [err], pending: false}
  const next = startRun(answered, 'a', 'k2', [], true)
  assert.deepEqual(visibleProblems(next, 'a'), [err])
  assert.equal(next.pending, true)
  assert.deepEqual(visibleProblems(startRun(answered, 'a', 'k2', [], false), 'a'), [])
  assert.deepEqual(visibleProblems(startRun(answered, 'b', 'k3', [], true), 'b'), [])
  assert.deepEqual(visibleProblems(answered, 'b'), [])
})
