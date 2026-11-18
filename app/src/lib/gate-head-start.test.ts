import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readMeWithHeadStart} from './gate-head-start.ts'

// A fake Barkpark: each read answers after `ms`.
const after = <T,>(ms: number, v: T) => new Promise<T>((r) => setTimeout(r, ms, v))
type Me = {email: string | null; noSeat?: boolean}
const letsIn = (me: Me) => !!me.email && !me.noSeat

test('the chain reads start beside me: the wait is the longest read, not the sum', async () => {
  const t0 = Date.now()
  let started = 0
  const {me, ahead} = await readMeWithHeadStart({
    cookieLetsIn: async () => true,
    readMe: () => after(120, {email: 'ada@example.com'}),
    start: () => ((started = Date.now() - t0), after(120, {desk: null, schemas: ['post']})),
    letsIn,
  })
  assert.equal(me.email, 'ada@example.com')
  assert.ok(started < 30, `the desk and schema reads started before me answered (at ${started} ms)`)
  assert.deepEqual(await ahead, {desk: null, schemas: ['post']})
  const took = Date.now() - t0
  assert.ok(took < 200, `me and the chain's first round trip took ${took} ms, not 240`)
})

test('me refuses (signed out, no seat): the head start is dropped, its reads never reach the page', async () => {
  for (const refused of [{email: null}, {email: 'ada@example.com', noSeat: true}]) {
    const page = new Map<string, unknown>() // what the request's client would hold
    let ran = false
    const {me, ahead} = await readMeWithHeadStart({
      cookieLetsIn: async () => true, // the cookie said yes; Barkpark then says no
      readMe: () => after(40, refused),
      start: () => ((ran = true), after(5, {desk: null, schemas: ['post'], list: ['post-01']})),
      letsIn,
    })
    await after(20, null) // the head start has answered by now
    if (ahead) page.set('chain', await ahead)
    assert.equal(ran, true)
    assert.equal(ahead, undefined, `nothing handed on for ${JSON.stringify(refused)}`)
    assert.deepEqual(me, refused)
    assert.equal(page.size, 0)
  }
})

test('a cookie that would not get in starts nothing: a signed-out request reads only me', async () => {
  let ran = false
  const {ahead} = await readMeWithHeadStart({cookieLetsIn: async () => false, readMe: () => after(5, {email: null}), start: () => ((ran = true), after(5, {})), letsIn})
  assert.equal(ran, false)
  assert.equal(ahead, undefined)
})
