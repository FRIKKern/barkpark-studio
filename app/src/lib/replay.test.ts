import {test} from 'node:test'
import assert from 'node:assert/strict'
import {lastPerDoc} from './replay.ts'

test('a replay sends each document its last frame, in order; a draft and its published doc are one', () => {
  const frames = [
    {id: 1, docId: 'drafts.old'}, // edited…
    {id: 2, docId: 'other'},
    {id: 3, docId: 'drafts.old'}, // …edited again…
    {id: 4, docId: 'old'}, // …then deleted (the published id)
    {id: 5, docId: 'drafts.new'},
  ]
  assert.deepEqual(lastPerDoc(frames).map((f) => f.id), [2, 4, 5])
})
