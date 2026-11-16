import {test} from 'node:test'
import assert from 'node:assert/strict'
import {docLocked, hideDoc, showDoc, unlessDocLocked} from './doc-lock.ts'

test('doc lock: locked while every pane showing the doc is locked, read when asked', () => {
  const draft = {}
  const revision = {}
  assert.equal(docLocked('d1'), false, 'no pane shows it')
  showDoc('d1', revision, true)
  assert.equal(docLocked('d1'), true, 'a revision only')
  showDoc('d1', draft, false)
  assert.equal(docLocked('d1'), false, 'beside it, the draft view')
  showDoc('d1', draft, true) // that pane was scheduled since
  assert.equal(docLocked('d1'), true)
  hideDoc('d1', revision)
  hideDoc('d1', draft)
  assert.equal(docLocked('d1'), false, 'all closed')
  assert.equal(docLocked('d2'), false, 'another doc')
})

test('doc lock: a write to a locked doc is refused, to an open one made, judged when it is called', () => {
  const pane = {}
  const writes: unknown[] = []
  const write = unlessDocLocked(([id]) => id, (id: string, value: string) => (writes.push([id, value]), true))
  showDoc('d3', pane, false)
  assert.equal(write('d3', 'a'), true)
  showDoc('d3', pane, true) // the pane went to a revision after the write function was made
  assert.equal(write('d3', 'b'), false)
  assert.equal(write('d4', 'c'), true, 'another doc, not shown')
  showDoc('d3', pane, false)
  write('d3', 'd')
  hideDoc('d3', pane)
  assert.deepEqual(writes, [['d3', 'a'], ['d4', 'c'], ['d3', 'd']])
})
