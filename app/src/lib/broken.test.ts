import {test} from 'node:test'
import assert from 'node:assert/strict'
import {invalidValue, keyProblem, richTextProblem, unknownFields} from './broken.ts'
import type {Field, Schema} from './data.ts'

const f = (type: string): Field => ({name: 'x', type})

test('wrong type, with Sanity converters', () => {
  assert.deepEqual(invalidValue(f('number'), '4'), {expected: 'number', actual: 'string', convert: 4})
  assert.deepEqual(invalidValue(f('boolean'), 'true'), {expected: 'boolean', actual: 'string', convert: true})
  assert.deepEqual(invalidValue(f('boolean'), 'yes'), {expected: 'boolean', actual: 'string'})
  assert.deepEqual(invalidValue(f('string'), 3), {expected: 'string', actual: 'number', convert: '3'})
  assert.deepEqual(invalidValue(f('richText'), 'plain'), {expected: 'object', actual: 'string'})
  assert.deepEqual(invalidValue(f('arrayOf'), {a: 1}), {expected: 'array', actual: 'object'})
  assert.equal(invalidValue(f('number'), 4), null)
  assert.equal(invalidValue(f('string'), null), null)
  assert.equal(invalidValue(f('json'), 'anything'), null)
})

test('list keys: missing, duplicate, fixed unique', () => {
  const missing = keyProblem([{_ref: 'a'}, {_ref: 'b', _key: 'k'}])!
  assert.equal(missing.kind, 'missing')
  assert.equal((missing.fixed[1] as {_key: string})._key, 'k')
  assert.match((missing.fixed[0] as {_key: string})._key, /^\w{12}$/)
  const dup = keyProblem([{_key: 'k'}, {_key: 'k'}])!
  assert.equal(dup.kind, 'duplicate')
  const [a, b] = dup.fixed as {_key: string}[]
  assert.equal(a!._key, 'k')
  assert.notEqual(b!._key, 'k')
  assert.equal(keyProblem([{_key: 'a'}, {_key: 'b'}]), null)
  assert.equal(keyProblem(['a', 'b']), null)
})

test('rich text blocks', () => {
  const p = richTextProblem({blocks: [{id: 'a', type: 'paragraph', content: []}, {type: 'paragraph', content: []}, {id: 'c'}, 'x']})!
  assert.deepEqual(p.problems.map((x) => x.reason), ['no block id', 'no block type', 'not a block'])
  assert.equal(p.fixed.blocks.length, 2)
  assert.equal(richTextProblem({blocks: [{id: 'a', type: 'paragraph', content: []}]}), null)
  assert.deepEqual(richTextProblem({blocks: 'x'})!.fixed, {blocks: []})
})

test('unknown fields skip system and server keys', () => {
  const s = {name: 'post', title: 'Post', fields: [{name: 'title', type: 'string'}]} as Schema
  assert.deepEqual(unknownFields(s, {_id: 'p', title: 't', oldField: 1, blocks: [], gone: null}), ['oldField'])
})
