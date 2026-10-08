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
