// J16: the timeline groups as Sanity 6.17's does (checked against the reference).
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {timeline, type Revision} from './timeline.ts'

let n = 0
const r = (action: string, status: 'draft' | 'published', actorId = 'a'): Revision => ({id: `r${++n}`, action, status, timestamp: `2026-10-08T12:00:${String(60 - n).padStart(2, '0')}Z`, actorId, author: actorId})
const shape = (es: ReturnType<typeof timeline>): unknown => es.map((e) => (e.children ? [e.label, shape(e.children)] : e.label))

test('edits since the last publish stay on top; each publish holds the edits it published', () => {
  // newest first
  const revs = [r('update', 'draft'), r('create', 'draft'), r('publish', 'published'), r('update', 'draft', 'b'), r('update', 'draft', 'b'), r('create', 'draft'), r('unpublish', 'draft'), r('publish', 'published'), r('create', 'draft')]
  assert.deepEqual(shape(timeline(revs)), ['Edited', 'Draft created', ['Published', ['Edited', 'Draft created']], 'Unpublished', ['Published', ['Draft created']]])
})

test("a run of one author's edits is one entry, counted", () => {
  const es = timeline([r('update', 'draft'), r('update', 'draft'), r('update', 'draft', 'b')])
  assert.deepEqual(es.map((e) => [e.label, e.count]), [['Edited', 2], ['Edited', 1]])
})

test('Review changes range: From is the state before its changes, To the state at it', async () => {
  const {reviewRange, rangeOptions, flatEntries} = await import('./timeline.ts')
  const revs = [r('update', 'draft', 'b'), r('update', 'draft'), r('create', 'draft'), r('publish', 'published')]
  const es = flatEntries(timeline(revs)) // Edited(b), Edited(a), Draft created, Published
  const [eb, ea, created] = es
  // From "Draft created" to now: base is the publish, all three draft writes credited.
  const all = reviewRange(revs, created!, null)
  assert.equal(all.base?.id, revs[3]!.id)
  assert.equal(all.target, undefined)
  assert.equal(all.between.length, 3)
  // From "Edited (a)" to "Edited (a)": base is the create, only a's write counts.
  const one = reviewRange(revs, ea!, ea!)
  assert.equal(one.base?.id, revs[2]!.id)
  assert.deepEqual(one.between.map((x) => x.id), [revs[1]!.id])
  // To can't be older than From; From can't be newer than To.
  const opts = rangeOptions(revs, es, ea!, ea!)
  assert.ok(!opts.to.includes(created!) && opts.to.includes(eb!))
  assert.ok(!opts.from.includes(eb!) && opts.from.includes(created!))
})
