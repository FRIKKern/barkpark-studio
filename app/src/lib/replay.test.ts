import {test} from 'node:test'
import assert from 'node:assert/strict'
import {withoutDeleted} from './replay.ts'

test('a replay drops the frames a later delete of their document makes moot, and keeps the rest in order', () => {
  const frames = [
    {id: 1, docId: 'old', mutation: 'create'},
    {id: 2, docId: 'other', mutation: 'patch'},
    {id: 3, docId: 'old', mutation: 'patch'}, // edited…
    {id: 4, docId: 'other', mutation: 'patch'}, // another doc's two frames both stay
    {id: 5, docId: 'old', mutation: 'delete'}, // …then deleted
    {id: 6, docId: 'again', mutation: 'delete'},
    {id: 7, docId: 'again', mutation: 'create'}, // made again after its delete: stays
  ]
  assert.deepEqual(withoutDeleted(frames).map((f) => f.id), [2, 4, 5, 6, 7])
})
