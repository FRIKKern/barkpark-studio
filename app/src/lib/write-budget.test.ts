// F4's write budget (node --test): a short edit goes at once, long typing keeps the old pace.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {WRITE_BURST, WRITE_GAP_MS, writeBudget} from './write-budget.ts'

const clock = () => {
  let t = 0
  return {now: () => t, tick: (ms: number) => void (t += ms)}
}

test('a short edit goes out at once', () => {
  const c = clock()
  const b = writeBudget(8, 750, c.now)
  for (let i = 0; i < 2; i++) assert.equal(b.wait(), 0), b.spend()
})

test('a minute of nonstop writing, over any number of documents, spends burst + one per gap', () => {
  const c = clock()
  const b = writeBudget(8, 750, c.now)
  let sent = 0
  for (let ms = 0; ms <= 60_000; ms += 10, c.tick(10)) while (b.wait() < 1) b.spend(), sent++
  assert.equal(sent, 8 + 80)
})

test('writes past the budget are owed', () => {
  const c = clock()
  const b = writeBudget(8, 750, c.now)
  for (let i = 0; i < 11; i++) b.spend() // 8, then 3 flushes that did not wait
  assert.equal(b.wait(), 4 * 750)
})

test("the studio's budget: a short edit at once, and long typing's first minute at most 80 writes", () => {
  const c = clock()
  const b = writeBudget(WRITE_BURST, WRITE_GAP_MS, c.now)
  assert.equal(b.wait(), 0)
  let sent = 0
  for (let ms = 0; ms <= 60_000; ms += 10, c.tick(10)) while (b.wait() < 1) b.spend(), sent++
  assert.ok(sent <= 80, `${sent} writes in the first minute`)
})
