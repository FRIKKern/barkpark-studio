// J54: the file field's accept rule and Sanity's size and type wording.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {accepts, ago, formatBytes, humanBytes, mayAccept, mimeTitle} from './files.ts'

test('accept: mime types, wildcards, extensions; while dragging an extension rule is a maybe', () => {
  assert.equal(accepts('application/pdf', {name: 'a.pdf', type: 'application/pdf'}), true)
  assert.equal(accepts('application/pdf', {name: 'a.txt', type: 'text/plain'}), false)
  assert.equal(accepts('image/*,.pdf', {name: 'A.PDF', type: ''}), true)
  assert.equal(accepts(undefined, {name: 'x', type: 'text/plain'}), true)
  assert.equal(mayAccept('application/pdf', 'text/plain'), false)
  assert.equal(mayAccept('.pdf', 'text/plain'), true)
})

test('sizes and types read as Sanity writes them', () => {
  assert.equal(formatBytes(99), '99 Bytes')
  assert.equal(formatBytes(2483770), '2.37 MB')
  assert.equal(humanBytes(99), '99 byte')
  assert.equal(humanBytes(2483770), '2.48 MB')
  assert.equal(mimeTitle('application/pdf'), 'PDF Document')
  assert.equal(mimeTitle('application/x-yaml'), 'Yaml')
  const now = Date.parse('2026-10-08T12:00:00Z')
  assert.equal(ago('2026-10-08T11:59:55Z', now), 'just now')
  assert.equal(ago('2026-10-08T11:59:00Z', now), '1 minute ago')
})
