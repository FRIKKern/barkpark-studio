// FF3: which editor a type opens in, from the schema's layout (barkpark#22280).
import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {Schema} from './data.ts'
import {editorMode} from './editor-mode.ts'

const schema = (name: string, fields: [string, string][], layout?: Schema['layout']): Schema => ({name, title: name, fields: fields.map(([n, type]) => ({name: n, type})), layout})
const region = (name: string) => ({kind: 'region', name})
const field = (name: string) => ({kind: 'field', name, max: 1})

test('a layout region that is a richText field: main; any other layout: alternative; none: none', () => {
  assert.equal(editorMode('note', schema('note', [['title', 'string'], ['body', 'richText']], [field('title'), region('body')])), 'main')
  assert.equal(editorMode('story', schema('story', [['title', 'string'], ['summary', 'text']], [field('title'), region('body')])), 'alternative')
  assert.equal(editorMode('post', schema('post', [['title', 'string'], ['body', 'richText']], [])), 'none')
  assert.equal(editorMode('post', schema('post', [['title', 'string']])), 'none')
  // The studio map overrides the schema.
  assert.equal(editorMode('paper', schema('paper', [['title', 'string']])), 'main')
})
