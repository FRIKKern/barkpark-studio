import {test} from 'node:test'
import assert from 'node:assert/strict'
import {resolveToday} from './today.ts'

// 23:30 UTC on 20 November: Oslo (UTC+1) is already on the 21st. Barkpark's
// api/test/barkpark/content/today_test.exs gives the same answers for the same clock.
const late = new Date('2026-11-20T23:30:00.123Z')
const sak = [
  {name: 'tittel', type: 'string'},
  {name: 'publisert', type: 'date'},
  {name: 'tid', type: 'datetime'},
  {name: 'meta', type: 'object', fields: [{name: 'dag', type: 'date'}]},
]

test("a new sak starts with today's date from initialValues $today", () => {
  assert.deepEqual(resolveToday({publisert: '$today'}, sak, late, 'Europe/Oslo'), {publisert: '2026-11-21'})
  assert.deepEqual(resolveToday({publisert: '$today'}, sak, late, 'UTC'), {publisert: '2026-11-20'})
  assert.deepEqual(resolveToday({publisert: '$today'}, sak, late, 'Not/AZone'), {publisert: '2026-11-20'})
})

test('a fixed initial value starts as written; only the exact string is a token', () => {
  const fixed = {publisert: '2026-01-01', tittel: 'Ny sak'}
  assert.equal(resolveToday(fixed, sak, late, 'Europe/Oslo'), fixed)
  assert.deepEqual(
    resolveToday({tittel: '$today', tid: '$today', meta: {dag: '$today'}, undeclared: '$today', year: '$today.year', a: '$todayx', b: ' $today', c: 'fra $today', d: '$tomorrow'}, sak, late, 'Europe/Oslo'),
    {tittel: '$today', tid: '2026-11-20T23:30:00.123Z', meta: {dag: '2026-11-21'}, undeclared: '2026-11-21', year: '2026', a: '$todayx', b: ' $today', c: 'fra $today', d: '$tomorrow'},
  )
})
