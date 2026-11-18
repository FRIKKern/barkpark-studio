import assert from 'node:assert/strict'
import {test} from 'node:test'
import {handOff, headStartAllowed, letsIn, readMeWithHeadStart, refusedLately} from './gate-head-start.ts'
import type {TokenSelf} from './token-self.ts'

/** A read whose answer the test gives when it chooses. */
const deferred = <T,>() => {
  let answer!: (v: T) => void
  const promise = new Promise<T>((r) => (answer = r))
  return {promise, answer}
}
const tick = () => new Promise((r) => setImmediate(r))
type Me = {signIn: string; email: string | null; noSeat?: boolean}

test('the chain reads start beside me: before me answers, not after it', async () => {
  const log: string[] = []
  const me = deferred<Me>()
  const chain = deferred<string>()
  const done = readMeWithHeadStart({
    cookieLetsIn: async () => true,
    readMe: () => (log.push('me asked'), me.promise),
    start: () => (log.push('chain started'), chain.promise),
    letsIn,
  })
  await tick()
  assert.deepEqual(log, ['chain started', 'me asked'], 'both are on their way while neither has answered')
  chain.answer('desk + schemas')
  me.answer({signIn: 'account', email: 'ada@example.com'})
  const {ahead} = await done
  assert.equal(await ahead, 'desk + schemas')
})

test('me refuses (signed out, no seat, studio token refused): the head start is dropped, its reads never reach the page', async () => {
  for (const refused of [{signIn: 'account', email: null}, {signIn: 'account', email: 'ada@example.com', noSeat: true}, {signIn: 'shared', email: null, studioTokenRefused: true}]) {
    const page = new Map<string, unknown>() // what the request's client would hold
    let ran = false
    const {me, ahead} = await readMeWithHeadStart({
      cookieLetsIn: async () => true, // the cookie said yes; Barkpark then says no
      readMe: async () => (await tick(), refused),
      start: () => ((ran = true), Promise.resolve({desk: null, schemas: ['post'], list: ['post-01']})),
      letsIn,
    })
    if (ahead) page.set('chain', await ahead)
    assert.equal(ran, true)
    assert.equal(ahead, undefined, `nothing handed on for ${JSON.stringify(refused)}`)
    assert.deepEqual(me, refused)
    assert.equal(page.size, 0)
  }
})

test('a cookie that would not get in starts nothing: a signed-out request reads only me', async () => {
  let ran = false
  const {ahead} = await readMeWithHeadStart({cookieLetsIn: async () => false, readMe: async () => ({signIn: 'account', email: null}), start: () => ((ran = true), 1), letsIn})
  assert.equal(ran, false)
  assert.equal(ahead, undefined)
})

test('the head start waits for me when Barkpark already refused the token or found no seat (from memory)', async () => {
  const ok: TokenSelf = {permissions: ['read', 'write'], boundDataset: null}
  const refused: TokenSelf = {permissions: [], boundDataset: null, refused: true}
  const seatless: TokenSelf = {permissions: [], boundDataset: null}
  const knows = (self?: TokenSelf) => () => (self ? Promise.resolve(self) : undefined)
  const ada = {token: 'ada-token'}
  assert.equal(await headStartAllowed('account', undefined, 'studio', knows()), false, 'signed out')
  assert.equal(await headStartAllowed('account', ada, 'studio', knows()), true, 'signed in, not asked lately')
  assert.equal(await headStartAllowed('account', ada, 'studio', knows(ok)), true)
  assert.equal(await headStartAllowed('account', ada, 'studio', knows(refused)), false, 'a refused token')
  assert.equal(await headStartAllowed('sso', ada, 'studio', knows(seatless)), false, 'no seat here')
  assert.equal(await headStartAllowed('shared', undefined, 'studio', knows()), true)
  assert.equal(await headStartAllowed('shared', undefined, 'studio', knows(refused)), false, "the studio's token refused")
})

test('letsIn: in when signed in or shared, with a seat and a live studio token', () => {
  assert.equal(letsIn({signIn: 'shared', email: null}), true)
  assert.equal(letsIn({signIn: 'account', email: 'ada@example.com'}), true)
  assert.equal(letsIn({signIn: 'account', email: null}), false)
  assert.equal(letsIn({signIn: 'account', email: 'ada@example.com', noSeat: true}), false)
  assert.equal(letsIn({signIn: 'shared', email: null, studioTokenRefused: true}), false)
})

test('the hand-off to the loader is per request and taken once', () => {
  const held = handOff<object, string>()
  const a = {}
  const b = {}
  held.put(a, 'a chain')
  assert.equal(held.take(b), undefined, "another request's loader finds none")
  assert.equal(held.take(a), 'a chain')
  assert.equal(held.take(a), undefined, 'taken once')
})

test("a dead login session, loaded again and again: the first load costs main's calls plus the two content-model reads, each replay what main costs; one logout per load", async () => {
  // A fake Barkpark that refuses the token. As a real login, the token is the session: a
  // sign-out forgets what was said of it (server/auth.ts forgetToken), so the next request asks
  // again; the refusal is also noted apart, for the head start only (server/auth.ts).
  const ws = 'studio-parity'
  const calls: string[] = []
  const said = new Map<string, Promise<TokenSelf>>()
  const refused = refusedLately()
  const describe = (token: string) => {
    if (!said.has(token)) said.set(token, (calls.push('GET /v1/auth/token'), refused.note(`${token} ${ws}`), Promise.resolve({permissions: [], boundDataset: null, refused: true})))
    return said.get(token)!
  }
  const known = (token: string) => (refused.has(`${token} ${ws}`) ? Promise.resolve<TokenSelf>({permissions: [], boundDataset: null, refused: true}) : said.get(token))
  const editor = {email: 'ada@example.com', token: 'login-1', session: 'login-1'}
  let named = false
  const load = async () => {
    const before = calls.length
    let once = false // this request's (server/auth.ts signOut)
    const signOut = () => once || ((once = true), calls.push('DELETE /v1/auth/logout'), said.delete(editor.session))
    const read = (path: string) => async () => (calls.push(`GET ${path}`), await tick(), signOut()) // its 401, a round trip later: signs out
    await readMeWithHeadStart({
      cookieLetsIn: () => headStartAllowed('account', editor, 'studio', known),
      readMe: async () => {
        if (!named) (named = true), calls.push('GET /v1/auth/me') // displayName, kept a minute
        const self = await describe(editor.token)
        if (self.refused) signOut()
        return {signIn: 'account', email: null}
      },
      start: () => Promise.all([read('/v1/schemas')(), read('/v1/data/doc/…/deskStructure')()]),
      letsIn,
    })
    await tick()
    await tick()
    return calls.slice(before).sort()
  }
  assert.deepEqual(await load(), ['DELETE /v1/auth/logout', 'GET /v1/auth/me', 'GET /v1/auth/token', 'GET /v1/data/doc/…/deskStructure', 'GET /v1/schemas'])
  for (let i = 0; i < 6; i++) assert.deepEqual(await load(), ['DELETE /v1/auth/logout', 'GET /v1/auth/token'], "a replay: main's two calls, no content-model read")
})

test('refused lately: a minute, bounded, and only what was noted', () => {
  const r = refusedLately(60_000, 2)
  r.note('dead studio-parity', 0)
  assert.equal(r.has('dead studio-parity', 59_999), true)
  assert.equal(r.has('dead other-ws', 1), false, 'per workspace')
  assert.equal(r.has('good studio-parity', 1), false)
  assert.equal(r.has('dead studio-parity', 60_000), false, 'a minute')
  for (const k of ['a', 'b', 'c']) r.note(k, 1)
  assert.equal(r.has('a', 2), false, 'the oldest goes past the cap')
  assert.equal(r.has('c', 2), true)
})
