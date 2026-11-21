// task-37691740e53e77b7: the + menu offers document types, never an embedded object type.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {isDocumentType, offersNew} from './creatable.ts'

test('object-kind schemas are not offered for creating', () => {
  const schemas = [{name: 'article'}, {name: 'articleHeroSection', kind: 'object'}, {name: 'page', kind: 'document'}]
  assert.deepEqual(schemas.filter(isDocumentType).map((s) => s.name), ['article', 'page'])
})

test('the + menu leaves out a singleton and a type with a fixed set of documents (task-f4c80d82cc25b19b)', () => {
  const schemas = [{name: 'article'}, {name: 'siteSettings', singleton: true}, {name: 'side', fixedDocuments: ['side-om-oss']}, {name: 'tom', fixedDocuments: []}, {name: 'hero', kind: 'object'}]
  assert.deepEqual(schemas.filter(offersNew).map((s) => s.name), ['article'])
})
