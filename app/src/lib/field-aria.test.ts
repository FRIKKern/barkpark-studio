import {test} from 'node:test'
import assert from 'node:assert/strict'
import {descId, fieldAria, problemId} from './field-aria.ts'

// scout-6: a field whose schema has a description is described by it (the <p> Fields.tsx
// draws under the label carries descId), and an errored one by its problem first.
// No fixture field has a description, so this is its check (the e2e one covers the error).
test('field aria: a described field points at its description; an error comes first and sets aria-invalid', () => {
  const described = {name: 'title', type: 'string', description: 'Shown in lists and as the tab title.'}
  assert.deepEqual(fieldAria('seo.title', described, false), {'aria-describedby': descId('seo.title'), 'aria-invalid': undefined})
  assert.equal(descId('seo.title'), 'seo.title-desc')
  assert.deepEqual(fieldAria('seo.title', described, true), {'aria-describedby': `${problemId('seo.title')} ${descId('seo.title')}`, 'aria-invalid': 'true'})
  assert.deepEqual(fieldAria('title', {}, false), {'aria-describedby': undefined, 'aria-invalid': undefined})
  assert.deepEqual(fieldAria('title', {description: ''}, true), {'aria-describedby': problemId('title'), 'aria-invalid': 'true'})
})
