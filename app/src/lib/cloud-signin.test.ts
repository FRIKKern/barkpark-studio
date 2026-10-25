import {test} from 'node:test'
import assert from 'node:assert/strict'
import {challengeOf, cloudConfig, cloudExchange, cloudStart, publicOrigin, stateMatches, type CloudPending} from './cloud-signin.ts'

const BP = 'https://bp.test'
const cfg = {cloudUrl: 'https://barkpark.cloud', instance: 'b1ed9b5d-247f-4122-98ea-f4af7f317576'}

test('task-74c3c0ab88eb4f53: Barkpark Cloud sign-in is offered only for account sign-in with both settings', () => {
  const env = {BARKPARK_CLOUD_URL: 'https://barkpark.cloud/', BARKPARK_CLOUD_INSTANCE: cfg.instance}
  assert.deepEqual(cloudConfig(env, true), cfg)
  assert.equal(cloudConfig(env, false), undefined)
  assert.equal(cloudConfig({BARKPARK_CLOUD_URL: env.BARKPARK_CLOUD_URL}, true), undefined)
  assert.equal(cloudConfig({BARKPARK_CLOUD_INSTANCE: cfg.instance}, true), undefined)
  assert.equal(publicOrigin({}, 'https://studio.test/auth/cloud/start?x=1'), 'https://studio.test')
  assert.equal(publicOrigin({STUDIO_PUBLIC_URL: 'https://pensum.test/'}, 'http://internal:3000/x'), 'https://pensum.test')
})

test('start: Cloud gets the instance, the exact callback, the state and the S256 challenge of the kept verifier', () => {
  const {pending, location} = cloudStart(cfg, 'https://studio.test', '/structure', 1_000_000)
  const url = new URL(location)
  assert.equal(`${url.origin}${url.pathname}`, 'https://barkpark.cloud/studio-signin')
  assert.equal(url.searchParams.get('instance'), cfg.instance)
  assert.equal(url.searchParams.get('return_to'), 'https://studio.test/auth/cloud/callback')
  assert.equal(url.searchParams.get('state'), pending.state)
  assert.equal(url.searchParams.get('code_challenge'), challengeOf(pending.verifier))
  assert.match(pending.verifier, /^[A-Za-z0-9_-]{43}$/)
  assert.ok(!location.includes(pending.verifier))
  assert.equal(pending.exp, 1000 + 600)
})

test('callback: the state must be this browser\'s, unexpired', () => {
  const {pending} = cloudStart(cfg, 'https://studio.test', '/structure')
  assert.ok(stateMatches(pending, pending.state))
  for (const bad of [undefined, null, '', 'x', pending.state + 'x']) assert.ok(!stateMatches(pending, bad), String(bad))
  assert.ok(!stateMatches(undefined, pending.state))
  assert.ok(!stateMatches({...pending, exp: 1}, pending.state))
})

const pending: CloudPending = {state: 's', verifier: 'v'.repeat(43), origin: 'https://studio.test', redirect: '/structure', exp: 2e9}
function fake(answers: Record<string, Response | 'down'>) {
  const calls: {url: string; init?: RequestInit}[] = []
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({url, init})
    const a = answers[`${init?.method ?? 'GET'} ${url.slice(BP.length)}`]
    if (!a || a === 'down') throw new TypeError('fetch failed')
    return a
  }) as typeof fetch
  return {f, calls}
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}})
const session = {token: 'sess', user: {id: 1, email: 'ed@x.no'}}
const seated = (slug: string) => ({kind: 'session', user: {id: 1}, seats: [{workspace: {slug}, role: 'editor', can: {read: true, write: true}}]})

test('exchange: a good ticket and a seat here sign the editor in; the verifier and audience go along', async () => {
  const {f, calls} = fake({'POST /v1/auth/login-tickets/exchange': json(201, session), 'GET /v1/auth/token': json(200, seated('gyldendal-no'))})
  assert.deepEqual(await cloudExchange({barkparkUrl: BP, ticket: 't', pending, workspace: 'gyldendal-no', fetch: f}), {ok: true, email: 'ed@x.no', token: 'sess'})
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {ticket: 't', audience: 'https://studio.test', code_verifier: pending.verifier})
})

test('exchange: a refused ticket, no seat here, or Barkpark down: refused with the reason, no session kept', async () => {
  const refused = fake({'POST /v1/auth/login-tickets/exchange': json(401, {error: {code: 'invalid_ticket'}})})
  assert.deepEqual(await cloudExchange({barkparkUrl: BP, ticket: 't', pending, workspace: 'w', fetch: refused.f}), {ok: false, error: 'ticket'})
  assert.deepEqual(await cloudExchange({barkparkUrl: BP, ticket: null, pending, workspace: 'w', fetch: refused.f}), {ok: false, error: 'ticket'})

  const elsewhere = fake({'POST /v1/auth/login-tickets/exchange': json(201, session), 'GET /v1/auth/token': json(200, seated('other')), 'DELETE /v1/auth/logout': json(200, {})})
  assert.deepEqual(await cloudExchange({barkparkUrl: BP, ticket: 't', pending, workspace: 'gyldendal-no', fetch: elsewhere.f}), {ok: false, error: 'not_seated'})
  const out = elsewhere.calls.find((c) => c.init?.method === 'DELETE')
  assert.equal(new Headers(out?.init?.headers).get('authorization'), 'Bearer sess')

  const down = fake({'POST /v1/auth/login-tickets/exchange': 'down'})
  assert.deepEqual(await cloudExchange({barkparkUrl: BP, ticket: 't', pending, workspace: 'w', fetch: down.f}), {ok: false, error: 'unavailable'})
})
