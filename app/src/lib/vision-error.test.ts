import {test} from 'node:test'
import assert from 'node:assert/strict'
import {localQueryError, queryError} from './vision-error.ts'

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

test('B01: Barkpark refusals Vision meets are told in the studio words; an unknown shape keeps Barkpark', () => {
  const t = (en: string, vars: Record<string, string | number> = {}) => en.replace(/\{(\w+)\}/g, (_, k: string) => `<${vars[k]}>`)
  const err = (error: object) => queryError('t?x', body(error))!
  const op = localQueryError(err({code: 'invalid_filter', message: 'unknown filter operator "zz" on field "nope"; valid operators: eq, neq', hint: 'Use one (eq, neq) — x', details: {op: 'zz', field: 'nope'}}), t)!
  assert.equal(op.message, 'Unknown filter operator "<zz>" on field "<nope>". Valid operators: <eq, neq>')
  assert.match(op.hint!, /<eq, neq>/)
  assert.match(localQueryError(err({code: 'malformed', message: '?limit= …', details: {parameter: 'limit', expected: 'integer', received: 'abc'}}), t)!.message, /<limit>.*<abc>/)
  assert.match(localQueryError(err({code: 'validation_failed', message: 'x', details: {order: ['unrecognised order spec "title:up"; expected']}}), t)!.message, /<title:up>/)
  assert.equal(localQueryError(err({code: 'not_found', message: 'document not found'}), t), null)
})

test('a GROQ parse error points at its byte range, on its own line', () => {
  const query = '*[_type == "post"]\n{title, nope(}'
  const body = JSON.stringify({error: {code: 'malformed', type: 'queryParseError', message: 'GROQ syntax error at byte 32: expected an expression', description: 'expected an expression', start: 32, end: 33, hint: 'Send a well-formed JSON body'}})
  const e = queryError(query, body)!
  assert.equal(e.message, 'expected an expression')
  assert.equal(e.hint, undefined)
  assert.deepEqual(e.spot, {line: '{title, nope(}', lineNumber: 2, column: 13, columnEnd: 14})
})

// Sanity Vision's code frame (task-a591294932d3284a): every line numbered, ">" on the bad one,
// carets under start..end whatever their width, the message after them.
test("a GROQ parse error draws Sanity's code frame", () => {
  const query = "*[_type=='author']\n  {name, 'x': lowr(name)}"
  const at = query.indexOf('lowr')
  const one = queryError(query, JSON.stringify({error: {code: 'malformed', type: 'queryParseError', message: 'x', description: 'Undefined function "lowr"', start: at, end: at + 1}}))!
  assert.equal(one.frame, ["  1 | *[_type=='author']", "> 2 |   {name, 'x': lowr(name)}", '    |               ^ Undefined function "lowr"'].join('\n'))
  const token = queryError(query, JSON.stringify({error: {code: 'malformed', type: 'queryParseError', message: 'x', description: 'Undefined function "lowr"', start: at, end: at + 4}}))!
  assert.match(token.frame!, /\|               \^\^\^\^ Undefined/)
  assert.equal(queryError('post?limit=abc', JSON.stringify({error: {message: '?limit= must be a whole number', details: {parameter: 'limit'}}}))!.frame, undefined)
})
