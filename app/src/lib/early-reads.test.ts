import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import {adopt, modelMemory, modelWithReadsAhead, type Ahead} from './early-reads.ts'
import {letsIn, readMeWithHeadStart, type Me} from './gate-head-start.ts'

/** A read whose answer the test gives when it chooses. */
const deferred = <T,>() => {
  let answer!: (v: T) => void
  const promise = new Promise<T>((r) => (answer = r))
  return {promise, answer}
}
const tick = () => new Promise((r) => setImmediate(r))
type Model = {desk: string | null; schemas: string[]}
const KEY = 'studio-parity default ci'

/** Reads begun on `known`: each answers when the test says, into a client of their own. */
function fakeAhead(log: string[]) {
  const own = new Map<string, unknown>()
  const reads = deferred<void>()
  const begin = (known: Model): Ahead<string> => {
    log.push(`reads begun on ${known.schemas.join('+')}`)
    return {done: reads.promise.then(() => void own.set('list post', ['post-01']).set('doc post-01', {_id: 'post-01'})), read: () => [...own]}
  }
  return {begin, answer: () => reads.answer()}
}

test('the list and doc reads start before the fresh model answers, on the model last read here', async () => {
  const memory = modelMemory<Model>()
  memory.put(KEY, {desk: null, schemas: ['post', 'author']})
  const log: string[] = []
  const fresh = deferred<Model>()
  const {begin, answer} = fakeAhead(log)
  const done = modelWithReadsAhead({key: KEY, memory, model: fresh.promise.then((m) => (log.push('fresh model'), m)), begin})
  await tick()
  assert.deepEqual(log, ['reads begun on post+author'], 'begun while the model read has not answered')
  fresh.answer({desk: null, schemas: ['post', 'author']})
  const {ahead} = await done
  assert.ok(ahead, 'the same model: the reads ahead are used')
  const page = new Map<string, unknown>([['doc post-01', 'held already']])
  answer()
  await adopt(ahead, (k) => page.has(k), (k, v) => void page.set(k, v))
  assert.deepEqual(page.get('list post'), ['post-01'])
  assert.equal(page.get('doc post-01'), 'held already', 'never over what the page holds')
})

test('a changed model discards the early reads: nothing of them reaches the page', async () => {
  for (const changed of [{desk: 'desk-v2', schemas: ['post', 'author']}, {desk: null, schemas: ['post']}, {desk: null, schemas: ['author', 'post']}]) {
    const memory = modelMemory<Model>()
    memory.put(KEY, {desk: null, schemas: ['post', 'author']})
    const log: string[] = []
    const {begin, answer} = fakeAhead(log)
    const {model, ahead} = await modelWithReadsAhead({key: KEY, memory, model: Promise.resolve(changed), begin})
    assert.equal(log.length, 1, 'they had begun')
    assert.equal(ahead, undefined, `dropped for ${JSON.stringify(changed)}`)
    assert.deepEqual(model, changed, 'the chain goes on with the fresh model')
    answer()
    const page = new Map<string, unknown>()
    await adopt<string>(ahead, (k) => page.has(k), (k, v) => void page.set(k, v))
    assert.equal(page.size, 0)
    assert.deepEqual(memory.get(KEY)?.model, changed, 'the fresh model is the one remembered')
  }
})

test('nothing remembered for this workspace, project and dataset: nothing begins early', async () => {
  const memory = modelMemory<Model>()
  memory.put('studio-parity default ci-2', {desk: null, schemas: ['post']})
  memory.put('other-workspace default ci', {desk: null, schemas: ['post']})
  const log: string[] = []
  const {begin} = fakeAhead(log)
  const {ahead} = await modelWithReadsAhead({key: KEY, memory, model: Promise.resolve({desk: null, schemas: ['post']}), begin})
  assert.deepEqual(log, [], 'another dataset or workspace never stands in')
  assert.equal(ahead, undefined)
  assert.deepEqual(memory.get(KEY)?.model, {desk: null, schemas: ['post']}, 'remembered for the next render')
})

test('a fresh model read that fails fails the chain as before', async () => {
  const memory = modelMemory<Model>()
  memory.put(KEY, {desk: null, schemas: ['post']})
  const log: string[] = []
  const {begin} = fakeAhead(log)
  await assert.rejects(modelWithReadsAhead({key: KEY, memory, model: Promise.reject(new Error('schemas 503')), begin}), /schemas 503/)
  assert.deepEqual(memory.get(KEY)?.model, {desk: null, schemas: ['post']}, 'a failed read is never remembered')
})

// A remembered model is only a guess at the URL's reads: one that no longer parses (the route's
// panesOf throws in begin) must never fail a page main would serve from the fresh model.
test('a remembered model the reads ahead cannot use never fails the render: it goes on as main does', async () => {
  const memory = modelMemory<Model>()
  memory.put(KEY, {desk: 'broken', schemas: ['post']})
  const fresh = {desk: null, schemas: ['post']}
  let tried = 0
  const {model, ahead} = await modelWithReadsAhead<Model, string>({key: KEY, memory, model: Promise.resolve(fresh), begin: () => {
    tried++
    throw new Error('the remembered desk no longer parses')
  }})
  assert.equal(tried, 1)
  assert.equal(ahead, undefined, 'nothing to adopt: the chain reads as on main')
  assert.deepEqual(model, fresh)
  assert.deepEqual(memory.get(KEY)?.model, fresh, 'the fresh model replaces the bad one')
  const page = new Map<string, unknown>()
  await adopt<string>(ahead, (k) => page.has(k), (k, v) => void page.set(k, v))
  assert.equal(page.size, 0)
})

test('the memory keeps the most recent scopes, at most cap', () => {
  const memory = modelMemory<number>(2)
  memory.put('a', 1)
  memory.put('b', 2)
  memory.put('a', 3)
  memory.put('c', 4)
  assert.equal(memory.get('b'), undefined, 'the least recent went')
  assert.equal(memory.get('a')?.model, 3)
  assert.equal(memory.get('c')?.model, 4)
})

// lib/structure-route.tsx cannot load under node:test: its code, comments left out.
const code = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|(^|[^:'"])\/\/.*$/gm, '$1')
const count = (text: string, re: RegExp) => text.match(new RegExp(re.source, 'g'))?.length ?? 0

test('the structure route reads ahead only on a render the head start let in, after the resume mark', () => {
  const route = code('./structure-route.tsx')
  assert.match(route, /const ahead = headStarts\.take\(queryClient\)\n/)
  assert.match(route, /loadPaneChain\(scratch, splat, published, !!ahead\)/, 'readAhead is the head start, taken: chainMayStart said yes and me let them in')
  assert.equal(count(route, /loadPaneChain\(/), 3, 'its definition, the server render and the browser')
  assert.match(route, /return \{\.\.\.\(await loadPaneChain\(queryClient, splat, published\)\), at: Date\.now\(\)\}\n/, 'the browser never reads ahead')
  assert.equal(count(route, /modelWithReadsAhead\(/), 1)
  const chain = route.slice(route.indexOf('async function loadPaneChain'))
  assert.ok(chain.indexOf('await fetchResumeMark()') < chain.indexOf('modelWithReadsAhead('), 'document reads come after the resume mark')
  assert.match(chain, /readAhead && onServer\s*\? await modelWithReadsAhead\(/)
  assert.match(route, /const own = new QueryClient\(/, 'the reads ahead run on a client of their own')
  assert.equal(count(route, /\badopt\(/), 1, 'one way into the page')
  assert.match(route, /adopt\(ahead, \(key\) => queryClient\.getQueryData\(key\) !== undefined, /, 'never over what the page holds: what it has is asked of its own client')
})

// The gate path end to end. render() wires the pure helpers as the route does: requireEditor's
// readMeWithHeadStart (cookie, then `me` and letsIn), loadPanes' `!!ahead`, then loadPaneChain's
// modelWithReadsAhead and adopt. The test after it pins that the route really wires them so:
// letsIn itself, not a stand-in, and the model keyed by the request's scope.
const seated: Me = {signIn: 'account', email: 'ada@example.com'}

/** One server render of a doc page: what began early, what reached the page, what is remembered. */
async function render(me: Me, cookie: boolean, remembered: Model | undefined, fresh: Model) {
  const memory = modelMemory<Model>()
  if (remembered) memory.put(KEY, remembered)
  const begun: Model[] = []
  const gate = await readMeWithHeadStart({cookieLetsIn: async () => cookie, readMe: async () => me, start: () => 'scratch', letsIn})
  const readAhead = !!gate.ahead
  const begin = (known: Model): Ahead<string> => (begun.push(known), {done: Promise.resolve(), read: () => [['doc post-03', {_id: 'post-03', from: 'early'}]]})
  const {ahead} = readAhead ? await modelWithReadsAhead({key: KEY, memory, model: Promise.resolve(fresh), begin}) : {ahead: undefined}
  const page = new Map<string, unknown>()
  await adopt(ahead, (k) => page.has(k), (k, v) => void page.set(k, v))
  return {begun, page, remembered: memory.get(KEY)?.model}
}
const m1 = {desk: null, schemas: ['post', 'author']}

test('a seated member, the cookie and me both say yes: reads ahead adopted only on an equal model', async () => {
  const same = await render(seated, true, m1, {desk: null, schemas: ['post', 'author']})
  assert.equal(same.begun.length, 1)
  assert.deepEqual(same.page.get('doc post-03'), {_id: 'post-03', from: 'early'})
  const changed = await render(seated, true, m1, {desk: null, schemas: ['post']})
  assert.equal(changed.begun.length, 1, 'they had begun')
  assert.equal(changed.page.size, 0, 'a changed model: nothing reaches the page')
  assert.deepEqual(changed.remembered, {desk: null, schemas: ['post']}, 'the fresh model is remembered')
})

test('the gate refuses (no seat, signed out, studio token refused, or the cookie says no): nothing begins, nothing is remembered', async () => {
  for (const [me, cookie] of [[{...seated, noSeat: true}, true], [{signIn: 'account', email: null}, true], [{signIn: 'shared', email: null, studioTokenRefused: true}, true], [seated, false]] as [Me, boolean][]) {
    // A fresh model unlike the remembered one: had the refused render read and kept it, the memory would say so.
    const r = await render(me, cookie, m1, {desk: 'changed since', schemas: ['post']})
    assert.deepEqual(r.begun, [], JSON.stringify(me))
    assert.equal(r.page.size, 0)
    assert.deepEqual(r.remembered, m1, 'the memory is untouched by a refused render')
  }
})

test('the route passes letsIn itself and keys the model by the request scope', () => {
  const route = code('./structure-route.tsx')
  assert.match(route, /readMeWithHeadStart\(\{[^}]*(^|[,{]\s*)letsIn\s*\}\)/, 'letsIn as imported, never a stand-in')
  assert.match(route, /modelWithReadsAhead\(\{key: await fetchModelScope\(\), /)
  assert.match(code('./data.ts'), /const at = scope\(\)\n\s*return `\$\{at\.workspace\} \$\{at\.project\} \$\{at\.dataset\}`/)
})
