// A decimal comma only where the studio's language writes one: nb reads "1,5" as 1.5;
// English never turns "1,500" (one thousand five hundred) into 1.5.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {decimalSeparator, parseNumber} from './number.ts'

test('number fields read a decimal comma in nb only', () => {
  const nb = decimalSeparator('nb-NO')
  const en = decimalSeparator('en-US')
  assert.equal(nb, ',')
  assert.equal(en, '.')
  assert.equal(parseNumber('1,5', nb), 1.5)
  assert.equal(parseNumber('1.5', nb), 1.5)
  assert.ok(Number.isNaN(parseNumber('1,500', en)))
  assert.equal(parseNumber('1.5', en), 1.5)
  assert.ok(Number.isNaN(parseNumber('1,2,3', nb)))
})
