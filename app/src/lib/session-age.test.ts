import {test} from 'node:test'
import assert from 'node:assert/strict'
import {absoluteEnd, IDLE_SECONDS, onRequest, sessionWindow, type SessionClock} from './session-age.ts'
import {tokenSelf} from './token-self.ts'

// task-4c981126f9255b29: a studio session ends at the instance's absolute session limit,
// however busy the editor is. The limit is what Barkpark answers, never a number here.
const HOUR = 60 * 60
const t0 = 1_800_000_000

/** An editor who signs in at t0 and makes a request every `step` seconds until signed out. */
function workUntilSignedOut(abs: number | undefined, step: number, known?: (now: number) => number | null | undefined) {
  let clock: SessionClock = {exp: sessionWindow(t0, abs).exp, ...(abs !== undefined && {abs})}
  for (let now = t0 + step; now < t0 + 400 * 24 * HOUR; now += step) {
    const r = onRequest(clock, now, known?.(now))
    if (!r.open) return now
    if (r.renew) clock = r.renew
  }
  return undefined
}

test('an active session needs sign-in at the absolute end, not later', () => {
  const abs = t0 + 30 * 24 * HOUR
  const signedOut = workUntilSignedOut(abs, HOUR)
  assert.equal(signedOut, abs, 'the first request at the absolute end finds no session')
  // A request every minute keeps the idle window open the whole way, and still ends there.
  assert.equal(workUntilSignedOut(abs, 60), abs)
})

test('the request just before the end is still signed in, the one at the end is not', () => {
  const abs = t0 + 8 * HOUR
  const clock = {exp: t0 + IDLE_SECONDS, abs}
  assert.deepEqual(onRequest(clock, abs - 1).open, true)
  assert.deepEqual(onRequest(clock, abs), {open: false})
})

test('the idle window never reaches past the absolute end, nor does the cookie', () => {
  const abs = t0 + 2 * HOUR
  assert.deepEqual(sessionWindow(t0, abs), {exp: abs, maxAge: 2 * HOUR})
  assert.deepEqual(sessionWindow(t0), {exp: t0 + IDLE_SECONDS, maxAge: IDLE_SECONDS})
})

test('without an absolute end, work keeps the session open and idling ends it', () => {
  assert.equal(workUntilSignedOut(undefined, HOUR), undefined)
  assert.equal(workUntilSignedOut(undefined, IDLE_SECONDS + 1), t0 + IDLE_SECONDS + 1)
})

test('a changed policy at the instance moves the end of a session already open', () => {
  const abs = t0 + 30 * 24 * HOUR
  // At day 2 the organization caps sessions at 3 days: Barkpark answers the sooner end.
  const tightened = (now: number) => (now >= t0 + 2 * 24 * HOUR ? t0 + 3 * 24 * HOUR : abs)
  assert.equal(workUntilSignedOut(abs, HOUR, tightened), t0 + 3 * 24 * HOUR)
  // Lifted again: the session runs to the end the instance answers now.
  const lifted = (now: number) => (now >= t0 + 2 * 24 * HOUR ? t0 + 40 * 24 * HOUR : abs)
  assert.equal(workUntilSignedOut(abs, HOUR, lifted), t0 + 40 * 24 * HOUR)
  // A sooner end reseals the cookie at once, its idle window cut to that end.
  assert.deepEqual(onRequest({exp: t0 + IDLE_SECONDS, abs}, t0 + HOUR, t0 + 2 * HOUR), {open: true, renew: {exp: t0 + 2 * HOUR, abs: t0 + 2 * HOUR}})
})

test("the end is read from Barkpark's answer for the token", () => {
  assert.equal(absoluteEnd('2026-12-04T12:00:00.123456Z'), Date.UTC(2026, 11, 4, 12) / 1000)
  assert.equal(absoluteEnd(null), undefined)
  assert.equal(absoluteEnd('soon'), undefined)
  const session = tokenSelf({kind: 'session', expires_at: '2026-12-04T12:00:00Z', seats: []}, 'w')
  assert.equal(session.expiresAt, Date.UTC(2026, 11, 4, 12) / 1000)
  assert.equal(tokenSelf({kind: 'session', expires_at: null, seats: []}, 'w').expiresAt, null)
  assert.equal(tokenSelf({kind: 'api', permissions: ['read']}, 'w').expiresAt, null)
})
