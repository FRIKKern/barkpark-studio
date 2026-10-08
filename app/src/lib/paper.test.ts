import {test} from 'node:test'
import assert from 'node:assert/strict'
import {checkLabel, labelEntries, slugFeedback} from './paper.ts'

test('slug feedback matches the LiveView rules', () => {
  assert.equal(slugFeedback('a-paper-2').tone, 'ok')
  assert.deepEqual(slugFeedback(''), {tone: 'warn', message: 'Slug is required'})
  assert.equal(slugFeedback('A-paper').message, 'Lowercase only — no capitals')
  assert.equal(slugFeedback('a paper').message, 'No spaces — use hyphens')
  assert.equal(slugFeedback('a--paper').tone, 'warn')
  assert.equal(slugFeedback('a_paper').message, 'Only lowercase letters, numbers, and hyphens')
})

test('labels: strongest first, legacy strings last, main tag marked, stored index kept', () => {
  const tags = ['legacy', {tag: 'weak', strength: 20, rationale: ' '}, {tag: 'Studio', strength: 85, rationale: 'why'}, {tag: ''}, 7]
  assert.deepEqual(labelEntries(tags, 'studio'), [
    {name: 'Studio', strength: 85, rationale: 'why', main: true, index: 2},
    {name: 'weak', strength: 20, rationale: null, main: false, index: 1},
    {name: 'legacy', strength: null, rationale: null, main: false, index: 0},
  ])
  assert.deepEqual(labelEntries(undefined, 'x'), [])
})

test('a new label needs a name, a 1–100 strength and a 20-character rationale', () => {
  assert.deepEqual(checkLabel(' ', '50', 'x'.repeat(20)), {error: 'A label needs a tag name.'})
  assert.match((checkLabel('t', '0', 'x'.repeat(20)) as {error: string}).error, /1 to 100/)
  assert.match((checkLabel('t', '5.5', 'x'.repeat(20)) as {error: string}).error, /1 to 100/)
  assert.match((checkLabel('t', '50', 'too short') as {error: string}).error, /20 characters/)
  assert.deepEqual(checkLabel(' t ', ' 50 ', ' a rationale of twenty+ '), {entry: {tag: 't', strength: 50, rationale: 'a rationale of twenty+'}})
})
