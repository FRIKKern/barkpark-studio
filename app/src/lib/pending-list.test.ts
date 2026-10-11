import {test} from 'node:test'
import assert from 'node:assert/strict'
import {sent, settle, shown, type Pending} from './pending-list.ts'

// J34: four quick Enters while `value` lags behind; every tag lands, in order.
test('four quick Enters with a lagging value keep every tag', () => {
  const start = ['fixture', 't0']
  let pending: Pending = null
  let value = start
  const enter = (tag: string) => {
    pending = settle(pending, value)
    const next = [...shown(pending, value), tag]
    pending = sent(pending, value, next)
    return next
  }
  const one = enter('one')
  const two = enter('two') // value still the start
  value = one // the first change is back
  enter('three')
  const four = enter('four')
  assert.deepEqual(four, ['fixture', 't0', 'one', 'two', 'three', 'four'])
  assert.deepEqual(shown(settle(pending, two), two), four) // an older echo doesn't win
  assert.equal(settle(pending, four), null) // caught up
})

test("someone else's value (or a refusal) wins at once", () => {
  const pending = sent(null, ['a'], ['a', 'b'])
  assert.equal(settle(pending, ['z']), null)
  assert.deepEqual(shown(settle(pending, ['a']), ['a']), ['a', 'b'])
})
