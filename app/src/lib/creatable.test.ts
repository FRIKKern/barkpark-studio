// task-37691740e53e77b7: the + menu offers document types, never an embedded object type.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {isDocumentType} from './creatable.ts'

test('object-kind schemas are not offered for creating', () => {
  const schemas = [{name: 'article'}, {name: 'articleHeroSection', kind: 'object'}, {name: 'page', kind: 'document'}]
  assert.deepEqual(schemas.filter(isDocumentType).map((s) => s.name), ['article', 'page'])
})
