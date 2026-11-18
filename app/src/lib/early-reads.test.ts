import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import {adopt, modelMemory, modelWithReadsAhead, type Ahead} from './early-reads.ts'

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
  assert.match(route, /return loadPaneChain\(queryClient, splat, published\)\n/, 'the browser never reads ahead')
  assert.equal(count(route, /modelWithReadsAhead\(/), 1)
  const chain = route.slice(route.indexOf('async function loadPaneChain'))
  assert.ok(chain.indexOf('await fetchResumeMark()') < chain.indexOf('modelWithReadsAhead('), 'document reads come after the resume mark')
  assert.match(chain, /readAhead && onServer\s*\? await modelWithReadsAhead\(/)
  assert.match(route, /const own = new QueryClient\(/, 'the reads ahead run on a client of their own')
  assert.equal(count(route, /\badopt\(/), 1, 'one way into the page')
})
