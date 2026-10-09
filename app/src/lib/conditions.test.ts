// J30 + barkpark#22554: a condition reads the document, or (scope "parent") its object.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {Field} from './data.ts'
import {isHidden} from './conditions.ts'

test('scope "parent" reads the enclosing object, the default reads the document', () => {
  const url = {name: 'url', type: 'url', visibleWhen: {field: 'kind', operator: 'eq', value: 'url', scope: 'parent'}} as unknown as Field
  const doc = {kind: 'internal', cta: {kind: 'url'}}
  assert.equal(isHidden(url, doc, doc.cta), false)
  assert.equal(isHidden(url, doc, {kind: 'internal'}), true)
  assert.equal(isHidden(url, doc), true) // no parent: the document's kind
  const top = {...url, visibleWhen: {field: 'kind', operator: 'eq', value: 'url'}} as unknown as Field
  assert.equal(isHidden(top, doc, doc.cta), true) // the default scope ignores the parent
})
