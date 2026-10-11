import {test} from 'node:test'
import assert from 'node:assert/strict'
import {queryError} from './vision-error.ts'

const body = (error: object) => JSON.stringify({error})

test('Vision errors: the bad part of the query, from what Barkpark names', () => {
  const q = 'post?filter[title][bogus]=x&limit=1'
  const op = queryError(q, body({message: 'unknown filter operator "bogus" on field "title"; valid operators: eq', hint: 'Use one'}))!
  assert.deepEqual(op.spot, {line: q, lineNumber: 1, column: 5, columnEnd: 27})
  assert.equal(op.hint, 'Use one')
  assert.equal(queryError('post?limit=abc', body({message: '?limit= must be a whole number', details: {parameter: 'limit'}}))!.spot?.column, 5)
  assert.equal(queryError('post?limit=1&order=nope', body({message: 'order failed', details: {order: ['unrecognised']}}))!.spot?.column, 13)
  assert.equal(queryError('post', body({message: 'not found'}))!.spot, undefined)
  assert.equal(queryError('post', '{"result":{}}'), null)
})
