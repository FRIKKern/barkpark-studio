// task-d996dafa8231ba46: the server's listen hub waits between upstream attempts. A
// refusal (Barkpark's `event: disconnect`, e.g. past its stream cap) or a 200 that ends
// at once used to reconnect every 500 ms forever, with nothing on screen.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {afterAttempt, initialBackoff, PAUSE_AFTER, QUICK_MS} from './listen-backoff.ts'

const mid = () => 0.5 // no jitter
const refused = {ok: true, refusal: 'too many open listen streams for this credential from this address (20)', livedMs: 30}
const quickEnd = {ok: true, refusal: null, livedMs: QUICK_MS - 1}
const lived = {ok: true, refusal: null, livedMs: 60_000}

test('a refusal backs off from 1 s, doubling to 60 s, and pauses with its reason at once', () => {
  let s = initialBackoff()
  const waits: number[] = []
  for (let i = 0; i < 9; i++) {
    const next = afterAttempt(s, refused, mid)
    waits.push(next.wait)
    s = next.state
    assert.equal(s.paused, refused.refusal)
  }
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000, 60_000])
})

test('the wait is jittered by up to a fifth either way', () => {
  const s = initialBackoff()
  assert.equal(afterAttempt(s, refused, () => 0).wait, 800)
  assert.equal(afterAttempt(s, refused, () => 1).wait, 1200)
})

test('200s that end at once back off too, and pause after a few in a row', () => {
  let s = initialBackoff()
  const waits: number[] = []
  for (let i = 1; i <= PAUSE_AFTER; i++) {
    const next = afterAttempt(s, quickEnd, mid)
    waits.push(next.wait)
    s = next.state
    assert.equal(s.paused === null, i < PAUSE_AFTER, `after ${i}`)
  }
  assert.deepEqual(waits, [1000, 2000, 4000])
  assert.match(s.paused!, /closing the live stream/)
})

test('a stream that lived resets: reconnect soon, not paused', () => {
  const backedOff = afterAttempt(afterAttempt(initialBackoff(), refused, mid).state, refused, mid).state
  const next = afterAttempt(backedOff, lived, mid)
  assert.equal(next.wait, 500)
  assert.equal(next.state.paused, null)
  assert.equal(next.state.quickEnds, 0)
})

test('a failed request keeps its old back-off (500 ms doubling to 10 s; a dead token waits a minute), not paused', () => {
  let s = initialBackoff()
  const waits: number[] = []
  for (let i = 0; i < 6; i++) {
    const next = afterAttempt(s, {ok: false, status: 502, livedMs: 0}, mid)
    waits.push(next.wait)
    s = next.state
  }
  assert.deepEqual(waits, [500, 1000, 2000, 4000, 8000, 10_000])
  assert.equal(s.paused, null)
  assert.equal(afterAttempt(initialBackoff(), {ok: false, status: 401, livedMs: 0}, mid).wait, 60_000)
})

test('a refresh (a new boot after a flip, the e2e cut and flip levers) reconnects at once and counts nothing', () => {
  const s = afterAttempt(afterAttempt(initialBackoff(), quickEnd, mid).state, quickEnd, mid).state
  const next = afterAttempt(s, {ok: true, refusal: null, livedMs: 10, refreshed: true}, mid)
  assert.equal(next.wait, 0)
  assert.deepEqual(next.state, s)
})

test('a blue/green flip never pauses: the old stream retires after living, one quick end, then the new one lives', () => {
  let s = initialBackoff()
  for (const a of [{...lived, livedMs: 5 * 60_000}, quickEnd, lived, quickEnd, lived]) {
    s = afterAttempt(s, a, mid).state
    assert.equal(s.paused, null)
  }
})

test('a stream that welcomed and is then refreshed starts the back-off over', () => {
  // Refused for a while, then taken (welcome), then cut by the hub (a flip seen, a write with no echo).
  let s = initialBackoff()
  for (let i = 0; i < 6; i++) s = afterAttempt(s, refused, mid).state
  const next = afterAttempt(s, {ok: false, livedMs: 0, refreshed: true, welcomed: true}, mid)
  assert.deepEqual(next, {state: initialBackoff(), wait: 0})
  // Quick ends either side of a taken stream are not "in a row": no pause.
  let q = afterAttempt(afterAttempt(initialBackoff(), quickEnd, mid).state, quickEnd, mid).state
  q = afterAttempt(q, {ok: false, livedMs: 0, refreshed: true, welcomed: true}, mid).state
  assert.equal(afterAttempt(q, quickEnd, mid).state.paused, null)
})
