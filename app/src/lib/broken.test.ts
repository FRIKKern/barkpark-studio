import {test} from 'node:test'
import assert from 'node:assert/strict'
import {invalidValue, keyProblem, richTextProblem, sanityPortableText, unknownFields, unsupportedAsset} from './broken.ts'
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

test('an asset this studio cannot show: Sanity export form, a foreign ref', () => {
  assert.deepEqual(unsupportedAsset(f('file'), {_type: 'file', _sanityAsset: 'file@file://./files/a.txt'}), {reason: 'sanityAsset', source: 'file@file://./files/a.txt'})
  assert.deepEqual(unsupportedAsset(f('image'), {asset: {_ref: 'image-abc-640x400-png'}}), {reason: 'foreignRef', source: 'image-abc-640x400-png'})
  // A Sanity image id in an image field: Barkpark serves it, so it is no warning (task-894b06f33c89ed1e).
  const sanityImage = {_type: 'image', asset: {_type: 'reference', _ref: `image-${'ab12'.repeat(10)}-640x400-png`}, alt: 'Synthetic alt'}
  assert.equal(unsupportedAsset(f('image'), sanityImage), null)
  // The same id in a file field, a Sanity file id, and a malformed image id stay unknown.
  assert.deepEqual(unsupportedAsset(f('file'), sanityImage), {reason: 'foreignRef', source: sanityImage.asset._ref})
  assert.deepEqual(unsupportedAsset(f('file'), {asset: {_ref: `file-${'ab12'.repeat(10)}-pdf`}}), {reason: 'foreignRef', source: `file-${'ab12'.repeat(10)}-pdf`})
  assert.deepEqual(unsupportedAsset(f('image'), {asset: {_ref: `image-${'ab12'.repeat(10)}-0x400-png`}}), {reason: 'foreignRef', source: `image-${'ab12'.repeat(10)}-0x400-png`})
  assert.equal(unsupportedAsset(f('image'), {asset: {_ref: 'asset-123'}}), null)
  assert.equal(unsupportedAsset(f('image'), {assetId: '123', url: '/x'}), null) // the legacy shape it reads
  assert.equal(unsupportedAsset(f('image'), null), null)
  assert.equal(unsupportedAsset(f('string'), {_sanityAsset: 'x'}), null)
})


test('Sanity Portable Text in a rich text field: read as its text', () => {
  const pt = [
    {_type: 'block', style: 'h2', children: [{_type: 'span', text: 'Heading'}], markDefs: []},
    {_type: 'block', listItem: 'bullet', children: [{_type: 'span', text: 'One '}, {_type: 'span', text: 'two'}]},
    {_type: 'callout', text: 'A custom block.'},
  ]
  assert.deepEqual(sanityPortableText(f('richText'), pt)?.lines, [
    {style: 'h2', text: 'Heading'},
    {style: 'listItem', text: 'One two'},
    {style: 'object', text: 'callout'},
  ])
  assert.equal(sanityPortableText(f('richText'), [{_type: 'callout'}]), null)
  assert.equal(sanityPortableText(f('richText'), {blocks: []}), null)
  assert.equal(sanityPortableText(f('arrayOf'), pt), null)
})
