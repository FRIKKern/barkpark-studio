// A second round of saves changes nothing (task-7777e1ba8c35d896): lib/edits.ts itself, as the
// browser runs it (write, send, the refusal and retry paths, applyServer, recoverPending), with
// lib/edit-bases.ts rebase() and the Portable Text merge, against a Barkpark kept in memory
// with its field fence. Only the network, the studio's server side and IndexedDB are stood in
// for (save-flow.hooks.mjs). Two pastes into one block: this page pastes "XX¶yy¶zz " at its
// start, another editor's save adds " one two three" at its end. In each case the stored text
// has every word once; then the same frames, faults and the editor's own value come again (a
// resend, a blur) and the stored text is the same.
import assert from 'node:assert/strict'
import {register} from 'node:module'
import {test} from 'node:test'
import {QueryClient} from '@tanstack/react-query'

register('./save-flow.hooks.mjs', import.meta.url)
const {freshItems} = await import('./pt-value.ts')
const {mergeBlock} = await import('./pt-keep.ts')
const {applyPaths, getPath, setPath} = await import('./paths.ts')
const {applyPatches, makePatches, parsePatch} = await import('@sanity/diff-match-patch')

type Doc = Record<string, unknown> & {_rev: string; _updatedAt: string}
type Block = {_type: string; _key: string; style: string; markDefs: unknown[]; children: {_type: string; _key: string; text: string; marks: string[]}[]}
const ID = 'post-save-flow'
const J = JSON.stringify
const clone = <T,>(v: T): T => JSON.parse(J(v))
const blk = (key: string, text: string, span = `${key}s`): Block => ({_type: 'block', _key: key, style: 'normal', markDefs: [], children: [{_type: 'span', _key: span, text, marks: []}]})
const texts = (v: unknown) => (v as Block[]).map((b) => b.children.map((c) => c.text).join(''))
const WORDS = ['Above', 'XX', 'yy', 'zz', 'Start text', 'one two three', 'Below']
const tick = (ms = 0) => new Promise((go) => setTimeout(go, ms))

// navigator.onLine: Node has a navigator, without it (edits.ts would wait for a network).
Object.defineProperty(globalThis.navigator, 'onLine', {value: true, configurable: true})

/** IndexedDB as lib/pending-edits.ts uses it: one store, kept across "reloads". */
const idb = new Map<string, unknown>()
const later = <T,>(result: () => T) => {
  const req: {result?: T; onsuccess?: () => void; onerror?: () => void} = {}
  queueMicrotask(() => ((req.result = result()), req.onsuccess?.()))
  return req
}
const inRange = (k: string, r?: {lower: string; upper: string}) => !r || (k >= r.lower && k <= r.upper)
const store = {
  put: (v: unknown, k: string) => later(() => void idb.set(k, structuredClone(v))),
  delete: (k: string) => later(() => void idb.delete(k)),
  get: (k: string) => later(() => structuredClone(idb.get(k))),
  getAll: (r?: {lower: string; upper: string}) => later(() => [...idb].filter(([k]) => inRange(k, r)).map(([, v]) => structuredClone(v))),
  getAllKeys: (r?: {lower: string; upper: string}) => later(() => [...idb.keys()].filter((k) => inRange(k, r))),
}
Object.assign(globalThis, {
  indexedDB: {open: () => later(() => ({transaction: () => ({objectStore: () => store})}))},
  IDBKeyRange: {bound: (lower: string, upper: string) => ({lower, upper})},
})

const retired = new Set<string>()
/** Barkpark, one document: revisions, the field fence, live frames, faults to order. */
class Server {
  doc!: Doc
  history: Doc[] = []
  n = 0
  /** For the next writes, in order: refused with a 500, landed with its answer lost, held until `release`. */
  faults: ('500' | 'lost' | 'hold')[] = []
  release = () => {}
  /** A write is held now (waiting for `release`). */
  holding = false
  /** Until a write is held (the save that was flushed has come in). */
  async held() {
    for (let i = 0; i < 400 && !this.holding; i++) await tick(5)
    assert.ok(this.holding, 'the save came in')
  }
  /** Pages that are gone (reloaded), for every server after too: a test's retry timers write nothing into the next test's. */
  gone = retired
  onRead?: () => void
  /** Revisions the history lists (Barkpark's may leave some out): all, unless set. */
  listed?: (d: Doc) => boolean
  /** Writes that set a field whole (`ptBody`), by field. */
  whole = new Map<string, number>()
  constructor(fields: Record<string, unknown>) {
    this.stamp({_id: `drafts.${ID}`, _publishedId: ID, _type: 'post', _draft: true, _hasPublished: false, ...fields})
  }
  /** Who wrote each revision: a page (`?page=…`) or another editor. */
  by = new Map<string, string>()
  stamp(d: Record<string, unknown>, by = 'theirs'): Doc {
    this.n++
    this.doc = {...clone(d), _rev: `r${this.n}`, _updatedAt: `2026-11-19T00:00:00.${String(this.n).padStart(6, '0')}Z`}
    this.history.push(this.doc)
    this.by.set(this.doc._rev, by)
    return clone(this.doc)
  }
  /** Another editor's save. */
  theirs(field: string, value: (now: unknown) => unknown): Doc {
    return this.stamp(setPath(this.doc, field, value(clone(this.doc[field]))))
  }
  async read(page: string) {
    if (this.gone.has(page)) return new Promise(() => {})
    const d = clone(this.doc)
    this.onRead?.()
    return d
  }
  async fetch(page: string, url: string, init: {body?: string}) {
    // A page that is gone writes nothing more (signed out there: no retry timers left behind).
    if (this.gone.has(page)) return answer(401, {error: {code: 'session_lost', message: 'The page is gone'}})
    // History reads (lib/edits.ts valuesBefore): newest first; a revision's content by its id.
    if (url.includes('/v1/data/history/')) return answer(200, {revisions: [...this.history].reverse().filter((h) => this.listed?.(h) ?? true).map((h) => ({id: h._rev, rev: h._rev, status: 'draft'}))})
    if (url.includes('/v1/data/revision/')) return answer(200, {revision: {content: clone(this.history.find((h) => h._rev === url.split('/').at(-1)))}})
    const fault = this.faults.shift()
    if (fault === 'hold') await new Promise<void>((go) => ((this.holding = true), (this.release = () => ((this.holding = false), go()))))
    if (fault === '500') return answer(500, {error: {code: 'internal_error', message: 'Internal Server Error'}})
    let doc: Record<string, unknown> = this.doc
    const warnings: {code: string}[] = []
    for (const m of JSON.parse(init.body!).mutations as {patch: {ifRevisionID?: string; fence?: string; set?: Record<string, unknown>; unset?: string[]; diffMatchPatch?: Record<string, string>}}[]) {
      const p = m.patch
      if (p.ifRevisionID) {
        const at = this.history.find((h) => h._rev === p.ifRevisionID)
        const roots = [...Object.keys(p.set ?? {}), ...(p.unset ?? [])].map((f) => f.split(/[.[]/)[0]!)
        // Barkpark's field fence: a stale rev passes when the fields it writes are unchanged since.
        const ok = p.fence === 'fields' ? !!at && roots.every((f) => J(at[f]) === J(doc[f])) : p.ifRevisionID === this.doc._rev
        if (!ok) return answer(412, {error: {code: 'precondition_failed', message: 'document revision mismatch'}})
      }
      for (const f of Object.keys(p.set ?? {})) if (/^\w+$/.test(f)) this.whole.set(f, (this.whole.get(f) ?? 0) + 1)
      doc = applyPaths(doc, Object.entries(p.set ?? {}))
      for (const u of p.unset ?? []) doc = setPath(doc, u, undefined)
      // A span patch goes onto the text there now (not fenced); a span that is gone: unmatched.
      for (const [path, patch] of Object.entries(p.diffMatchPatch ?? {})) {
        const now = getPath(doc, path)
        if (typeof now !== 'string') warnings.push({code: 'patch.path_unmatched'})
        else doc = setPath(doc, path, applyPatches(parsePatch(patch), now, {allowExceedingIndices: true})[0])
      }
    }
    const saved = this.stamp(doc, page)
    if (fault === 'lost') throw new TypeError('fetch failed')
    return answer(200, {transactionId: saved._rev, results: [{id: ID, operation: 'update', document: saved}], ...(warnings.length ? {warnings} : {})})
  }
}
const answer = (status: number, body: unknown) => ({ok: status < 300, status, json: async () => body})

let server: Server
;(globalThis as Record<string, unknown>).saveFlowServer = {
  fetch: (page: string, ...a: [string, {body?: string}]) => server.fetch(page, ...a),
  read: (page: string) => server.read(page),
}
const merges = () => ((globalThis as Record<string, unknown>).saveFlowMerges ??= []) as {page: string; rev: string; field: string; base: string}[]

type Edits = typeof import('./edits.ts')
/** A browser page: its own lib/edits.ts (and everything it imports), its own query cache. */
async function open(name: string) {
  const E = (await import(`./edits.ts?page=${name}`)) as Edits
  const qc = new QueryClient()
  qc.setQueryData(['doc', ID], clone(server.doc))
  const held = () => qc.getQueryData<Doc>(['doc', ID])!
  // The Portable Text input's save of the field (components/PortableTextInput.tsx): onto the
  // blocks as held now, from what the screen drew (lib/pt-value.ts freshItems).
  const save = (drawn: unknown, next: unknown[]) => E.edit(qc, held() as never, 'ptBody', (now: unknown) => freshItems(drawn, next, now))
  // Until nothing is waiting: what a retry timer would send, sent now.
  const drain = async () => {
    for (let i = 0; i < 40; i++) {
      E.flush(qc, ID)
      if (await Promise.race([E.whenSaved(ID).then(() => true), tick(20).then(() => false)])) return
    }
    assert.fail(`${name}: still saving`)
  }
  // Typing in a span (PortableTextInput's text save): its own patch, onto the span as held then.
  const type = (key: string, from: string, to: string, at = 0) => {
    const own = makePatches(from, to)
    // The span's key as the page holds it (a merge may give a moved text its own span's key).
    const span = (held().ptBody as Block[]).find((b) => b._key === key)!.children.at(at)!._key
    E.edit(qc, held() as never, `ptBody[_key=="${key}"].children[_key=="${span}"].text`, (now: unknown) => applyPatches(own, typeof now === 'string' ? now : '')[0])
  }
  return {name, E, qc, held, save, type, drain, frame: (d: Doc) => E.applyServer(qc, clone(d) as never)}
}

const paste = (drawn: Block[]) => drawn.flatMap((b) => (b._key === 'b1' ? [blk('b1', 'XX', 'p1'), blk('y', 'yy'), blk('z', `zz ${b.children[0]!.text}`)] : [b]))
const addWords = (now: unknown) => (now as Block[]).map((b) => (b._key === 'b1' ? blk('b1', `${b.children[0]!.text} one two three`) : b))

/** Every word once in what Barkpark stores; then the same again changes nothing. */
async function rounds(name: string, first: (page: Awaited<ReturnType<typeof open>>) => Promise<{again: () => Promise<void>}>) {
  server = new Server({title: 'Save flow', ptBody: [blk('a', 'Above'), blk('b1', 'Start text'), blk('c', 'Below')]})
  merges().length = 0
  const page = await open(name)
  const {again} = await first(page)
  const once = (when: string) => {
    const all = texts(server.doc.ptBody).join('|')
    for (const w of WORDS) assert.equal(all.split(w).length - 1, 1, `${name}, ${when}: "${w}" in ${J(texts(server.doc.ptBody))}`)
  }
  once('round 1')
  const round1 = J(server.doc.ptBody)
  await again()
  once('round 2')
  assert.equal(J(server.doc.ptBody), round1, `${name}: round 2 changed the stored text`)
  // A merge takes in each server revision once, from one base, and never one of the page's own
  // writes as someone else's: those words are not merged in again (no text guess keeps them once).
  if (process.env.FLOW_LOG) console.log(name, J({revs: server.n, merged: merges().map((m) => `${m.page} ${m.rev}`), stored: texts(server.doc.ptBody)}))
  const seen = new Set<string>()
  for (const m of merges()) {
    assert.notEqual(server.by.get(m.rev), m.page, `${name}: ${m.page} merged its own write ${m.rev} as someone else's`)
    const k = `${m.page} ${m.rev} ${m.field} ${m.base}`
    assert.ok(!seen.has(k), `${name}: ${m.page} merged ${m.rev} twice from the same base`)
    seen.add(k)
  }
}

/** Round 2 for a page: the editor sends what it shows, and every frame Barkpark sent comes again, while that is on its way and after. */
const replay = (page: Awaited<ReturnType<typeof open>>, faults: Server['faults'] = []) => async () => {
  server.faults.push(...faults)
  const shown = page.held().ptBody as Block[]
  page.save(shown, shown)
  for (const d of server.history) page.frame(d)
  await page.drain()
  for (const d of server.history) page.frame(d)
}

test('a save refused with a 500, then retried', () =>
  rounds('retry500', async (page) => {
    const drawn = page.held().ptBody as Block[]
    server.theirs('ptBody', addWords)
    server.faults.push('500')
    page.save(drawn, paste(drawn))
    await page.drain()
    return {again: replay(page, ['500'])}
  }))

test('a save refused (412) and merged again', () =>
  rounds('refused', async (page) => {
    const drawn = page.held().ptBody as Block[]
    server.theirs('ptBody', addWords)
    page.save(drawn, paste(drawn))
    await page.drain()
    return {again: replay(page)}
  }))

test('the same server frame twice, while the save is on its way and after it', () =>
  rounds('frame2', async (page) => {
    const drawn = page.held().ptBody as Block[]
    server.faults.push('hold')
    page.save(drawn, paste(drawn))
    await tick(5)
    const theirs = server.theirs('ptBody', addWords)
    page.frame(theirs)
    page.frame(theirs)
    server.release()
    await page.drain()
    page.frame(theirs)
    await page.drain()
    return {again: replay(page)}
  }))

test('two refusals in a row', () =>
  rounds('twice', async (page) => {
    const drawn = page.held().ptBody as Block[]
    server.theirs('ptBody', addWords)
    // Another save lands right after this page reads the document to merge.
    server.onRead = () => ((server.onRead = undefined), server.theirs('ptBody', (now) => (now as Block[]).map((b) => (b._key === 'c' ? blk('c', 'Below four five') : b))))
    page.save(drawn, paste(drawn))
    await page.drain()
    assert.deepEqual(texts(server.doc.ptBody).at(-1), 'Below four five')
    return {again: replay(page)}
  }))

test('a retry after a reload', () =>
  rounds('reload', async (page) => {
    page.E.setKeepScope('s')
    const drawn = page.held().ptBody as Block[]
    server.theirs('ptBody', addWords)
    server.faults.push('500')
    page.save(drawn, paste(drawn))
    await tick(250) // kept in this browser (KEEP_GAP_MS), then the page reloads
    server.gone.add('?page=reload')
    const next = await open('reload2')
    next.E.setKeepScope('s')
    const got = await next.E.recoverPending(next.qc, next.held() as never)
    // Someone saved since: the pane offers the kept edits, and the editor restores them.
    if (got && 'ask' in got) next.E.restorePending(next.qc, next.held() as never, got.ask)
    await next.drain()
    return {again: replay(next)}
  }))

// Typing sent as a span patch while another editor's paste split that block
// (task-30946f2255a30d93, task-ab6d751fa53fbda5): Barkpark puts the patch on the span as it is
// now, where its words are no longer. The span's field as it was before the patch is read
// and this editor's typing merged onto it through the merge exit and its net: every word once,
// deleted letters deleted, and this page's copy is what is stored. `before`: typed before the
// paste's frame comes (the first of it on its way then, when `sent`); `after`: typed once the
// screen shows the split, in the block where the words are now.
type Typed = [key: string, add: (text: string) => string]
async function spanSave(name: string, {before, after = []}: {before: Typed[]; after?: Typed[]}, want: string[], sent = true) {
  server = new Server({title: 'Save flow', ptBody: [blk('a', 'Above'), blk('b1', 'Start text'), blk('c', 'Below')]})
  const page = await open(name)
  const span = (key: string) => (page.held().ptBody as Block[]).find((b) => b._key === key)!.children[0]!.text
  const typeIn = ([key, add]: Typed) => page.type(key, span(key), add(span(key)))
  // The other paste: "QQ¶rr " after "Start ", the block split there (its tail keyed anew).
  const split = (now: unknown) => (now as Block[]).flatMap((b) => (b._key === 'b1' ? [blk('b1', 'Start QQ'), blk('r', `rr ${b.children[0]!.text.slice(6)}`)] : [b]))
  const [first, ...more] = before
  if (sent) server.faults.push('hold')
  typeIn(first!)
  if (sent) page.E.flush(page.qc, ID)
  await (sent ? server.held() : tick(5))
  for (const t of more) typeIn(t)
  page.frame(server.theirs('ptBody', split))
  for (const t of after) typeIn(t)
  server.release()
  await page.drain()
  for (const d of server.history) page.frame(d)
  await page.drain()
  if (process.env.FLOW_LOG) console.log(name, J({stored: texts(server.doc.ptBody), held: texts(page.held().ptBody)}))
  assert.deepEqual(texts(server.doc.ptBody), want, `${name}: stored`)
  assert.deepEqual(texts(page.held().ptBody), want, `${name}: this page's copy`)
  return page
}

const end = (w: string) => (t: string) => `${t} ${w}`
const typing = {before: [['b1', end('four')], ['b1', end('five')]] as Typed[], after: [['r', end('six')]] as Typed[]}
const deleting = {before: [['b1', (t: string) => t.replace('e', '')], ['b1', (t: string) => t.replace('x', '')]] as Typed[]}

test('typing sent as a span patch, and more, while another paste split the block', async () => void (await spanSave('spanType', typing, ['Above', 'Start QQ', 'rr text four five six', 'Below'])))

test('letters deleted as a span patch while another paste split the block stay deleted', async () => void (await spanSave('spanDelete', deleting, ['Above', 'Start QQ', 'rr tt', 'Below'])))

test('typing, the last of it not yet sent when the frame of another paste that split the block comes', async () => void (await spanSave('spanFrame', typing, ['Above', 'Start QQ', 'rr text four five six', 'Below'], false)))

test('letters deleted, the last not yet sent when the frame of another paste that split the block comes', async () => void (await spanSave('spanFrameDelete', deleting, ['Above', 'Start QQ', 'rr tt', 'Below'], false)))

// The field put right goes whole; a span typed only since (the tail's first span here) keeps
// no base from before, or its next key sends the earlier words again.
for (const at of [0, -1])
  test(`typing again in the tail's ${at ? 'last' : 'first'} span after the field was put right: every word once`, async () => {
    const page = await spanSave(`spanAgain${at}`, typing, ['Above', 'Start QQ', 'rr text four five six', 'Below'])
    const tail = () => (page.held().ptBody as Block[]).find((b) => b._key === 'r')!.children.at(at)!.text
    for (const w of ['X', 'Y']) {
      page.type('r', tail(), `${tail()}${w}`, at)
      await page.drain()
      for (const d of server.history) page.frame(d)
      await page.drain()
    }
    const all = texts(server.doc.ptBody).join('|')
    for (const w of ['four', 'five', 'six', 'X', 'Y']) assert.equal(all.split(w).length - 1, 1, `${w} once in ${all}`)
    assert.deepEqual(texts(page.held().ptBody), texts(server.doc.ptBody), 'this page equals stored')
  })

// Two editors typing in one span with no block added or removed: the answer's text is what the
// merge exit gives, so no whole-field write goes and the span keeps its one key.
test('both typing in one span, no split: no write but the span patch, one span', async () => {
  server = new Server({title: 'Save flow', ptBody: [blk('a', 'Above'), blk('b1', 'Start text'), blk('c', 'Below')]})
  const page = await open('sameSpan')
  let reads = 0
  const fetch = server.fetch.bind(server)
  server.fetch = async (p: string, url: string, init: {body?: string}) => (url.includes('/v1/data/history/') && reads++, fetch(p, url, init))
  for (let i = 0; i < 3; i++) {
    // Their key at the span's start lands first (its frame not here yet), then this page's at its end.
    server.theirs('ptBody', (now) => (now as Block[]).map((b) => (b._key === 'b1' ? blk('b1', `Q${b.children[0]!.text}`) : b)))
    const now = (page.held().ptBody as Block[])[1]!.children[0]!.text
    page.type('b1', now, `${now}x`)
    await page.drain()
    for (const d of server.history) page.frame(d)
    await page.drain()
  }
  assert.deepEqual(texts(server.doc.ptBody), ['Above', 'QQQStart textxxx', 'Below'])
  assert.deepEqual(texts(page.held().ptBody), texts(server.doc.ptBody))
  assert.equal((server.doc.ptBody as Block[])[1]!.children.length, 1, 'one span')
  // The cost: an answer that is not what was sent (their key landed in the span first) is
  // checked against the field just before the patch, one history read per such save.
  assert.equal(reads, 3, 'history reads')
})

// Two typing in one span, this page's typing going on while its save is out and the other's
// words land first (portable-text.spec "two editors typing in one block at once").
for (const frameFirst of [false, true])
  test(`both typing in one span, typing on while the save is out${frameFirst ? ', their frame here first' : ''}: every word once, in place`, async () => {
    server = new Server({title: 'Save flow', ptBody: [blk('a', 'Above'), blk('b1', 'Pour slowly'), blk('c', 'Below')]})
    const page = await open(`sameSpanOn${frameFirst}`)
    const now = () => (page.held().ptBody as Block[])[1]!.children[0]!.text
    const add = (w: string) => page.type('b1', now(), `${now()}${w}`)
    const mine = [' from', ' a', ' height', ' up']
    const theirs = [' gently', ' and', ' so']
    for (let i = 0; i < 4; i++) {
      server.faults.push('hold')
      add(mine[i]!)
      page.E.flush(page.qc, ID)
      await server.held()
      if (i < 3) {
        // Their word after "Pour …" (where their caret is), as Barkpark merges their span patch.
        const d = server.theirs('ptBody', (v) => (v as Block[]).map((b) => (b._key === 'b1' ? blk('b1', b.children[0]!.text.replace(/^(Pour(?: \w+)*?)( slowly)/, `$1${theirs[i]}$2`)) : b)))
        if (frameFirst) page.frame(d)
      }
      if (i % 2 === 0) add('!')
      server.release()
      await page.drain()
      for (const d of server.history) page.frame(d)
      await page.drain()
    }
    const stored = texts(server.doc.ptBody)
    if (process.env.FLOW_LOG) console.log(J({stored, held: texts(page.held().ptBody)}))
    assert.equal(stored[1], 'Pour gently and so slowly from! a height! up')
    assert.deepEqual(texts(page.held().ptBody), stored)
    assert.equal(server.whole.get('ptBody') ?? 0, 0, 'no whole-field write')
  })
  // The answer to a patch is never written back whole for the order of words two typed at one
  // spot (Barkpark's patch and the merge order them differently; both are right), nor merged
  // from a revision the patch did not land on (a history that leaves one out).
  for (const listed of [undefined, (d: Doc) => d._rev !== 'r3'])
    test(`both typing at the end of one span${listed ? ', the revision before not in the history' : ''}: the span patch's answer stands (no whole write) unless a letter in it is lost, doubled or in another block, and only then does the field go whole`, async () => {
      server = new Server({title: 'Save flow', ptBody: [blk('a', 'Above'), blk('b1', 'Pour slowly'), blk('c', 'Below')]})
      server.listed = listed
      const page = await open(`atEnd${!!listed}`)
      const now = () => (page.held().ptBody as Block[])[1]!.children[0]!.text
      server.faults.push('hold')
      page.type('b1', now(), 'Pour slowly gently')
      page.E.flush(page.qc, ID)
      await server.held()
      // Theirs at the same spot, two keys, each its own revision (r2, r3), before this page's patch.
      const at = (w: string) => server.theirs('ptBody', (v) => (v as Block[]).map((b) => (b._key === 'b1' ? blk('b1', `${b.children[0]!.text}${w}`) : b)))
      // One key of theirs, or two with the one just before this patch left out of the history.
      if (listed) at(' so')
      at(' and')
      server.release()
      await page.drain()
      for (const d of server.history) page.frame(d)
      await page.drain()
      const stored = texts(server.doc.ptBody)[1]!
      if (process.env.FLOW_LOG) console.log(J({stored, held: texts(page.held().ptBody), whole: [...server.whole]}))
      for (const w of ['gently', 'and', ...(listed ? ['so'] : []), 'slowly']) assert.equal(stored.split(w).length - 1, 1, `${w} once in ${stored}`)
      assert.equal(server.whole.get('ptBody') ?? 0, 0, 'no whole-field write')
      assert.deepEqual(texts(page.held().ptBody), texts(server.doc.ptBody))
    })

// task-2c01c385ce7b51d0: this page pastes into a block and reloads while that save is out (refused,
// its answer lost, or still on its way); the other editor pastes into the same block meanwhile.
// After the reload, the kept edits come back: both pastes are stored once each, and the page shows it.
for (const mine of ['paragraphs', 'line'] as const)
for (const fault of ['500', 'lost', 'hold'] as const)
  test(`a paste kept while this page reloads mid-save (${mine}, ${fault}), the other pasting into the same block: both pastes once`, async () => {
    server = new Server({title: 'Save flow', ptBody: [blk('a', 'Above'), blk('b1', 'Start text'), blk('c', 'Below')]})
    const name = `pasteReload${mine}${fault}`
    const page = await open(name)
    page.E.setKeepScope('s')
    const drawn = page.held().ptBody as Block[]
    server.faults.push(fault)
    // Paragraphs at the block's start (the field goes whole), or a line at its end (the block by its key).
    if (mine === 'paragraphs') page.save(drawn, paste(drawn))
    else {
      const from = drawn[1]!
      const line = blk('b1', 'Start text one two three')
      page.E.edit(page.qc, page.held() as never, 'ptBody[_key=="b1"]', (now: unknown) => mergeBlock(from, line, now) ?? line)
    }
    await (fault === 'hold' ? server.held() : tick(250)) // kept in this browser (KEEP_GAP_MS)
    if (fault === 'hold') await tick(250)
    // The other editor's paste: "QQ¶rr " after "Start ", splitting that block.
    server.theirs('ptBody', (now) => (now as Block[]).flatMap((b) => (b.children[0]!.text.includes('Start ') ? [blk(b._key, b.children[0]!.text.replace(/Start .*/, 'Start QQ')), blk('r', `rr ${b.children[0]!.text.replace(/.*Start /, '')}`)] : [b])))
    server.gone.add(`?page=${name}`)
    if (fault === 'hold') server.release()
    await tick(20)
    const next = await open(`${name}2`)
    next.E.setKeepScope('s')
    const got = await next.E.recoverPending(next.qc, next.held() as never)
    if (got && 'ask' in got) next.E.restorePending(next.qc, next.held() as never, got.ask)
    await next.drain()
    for (const d of server.history) next.frame(d)
    await next.drain()
    const stored = texts(server.doc.ptBody)
    if (process.env.FLOW_LOG) console.log(name, J({got: got && Object.keys(got), stored, held: texts(next.held().ptBody)}))
    const all = stored.join('|')
    for (const w of ['Above', ...(mine === 'paragraphs' ? ['XX', 'yy', 'zz'] : ['one two three']), 'QQ', 'rr', 'Start', 'text', 'Below']) assert.equal(all.split(w).length - 1, 1, `"${w}" once in ${J(stored)}`)
    assert.deepEqual(texts(next.held().ptBody), stored, 'the page shows what is stored')
    server.gone.add(`?page=${name}2`)
  })

// As the browser does it: the other pastes paragraphs at the block's start. The block's key
// stays on the first piece ("x"), a middle paragraph holds none of its letters ("y"), and the
// block's text goes on in a new block ("zStart text"). This page's line kept at the key goes
// back at the end of that text, not after "x".
for (const fault of ['500', 'lost', 'hold'] as const)
  test(`a line kept while this page reloads mid-save (${fault}), the other pasting paragraphs at the block's start: the line goes back after the block's text`, async () => {
    server = new Server({title: 'Save flow', ptBody: [blk('a', 'Above'), blk('b1', 'Start text'), blk('c', 'Below')]})
    const name = `pasteReloadStart${fault}`
    const page = await open(name)
    page.E.setKeepScope('s')
    const drawn = page.held().ptBody as Block[]
    server.faults.push(fault)
    const line = blk('b1', 'Start text one two three')
    page.E.edit(page.qc, page.held() as never, 'ptBody[_key=="b1"]', (now: unknown) => mergeBlock(drawn[1]!, line, now) ?? line)
    await (fault === 'hold' ? server.held() : tick(250))
    if (fault === 'hold') await tick(250)
    server.theirs('ptBody', (now) => (now as Block[]).flatMap((b) => (b._key === 'b1' ? [blk('b1', 'x'), blk('ny', 'y'), blk('nz', `z${b.children[0]!.text}`)] : [b])))
    server.gone.add(`?page=${name}`)
    if (fault === 'hold') server.release()
    await tick(20)
    const next = await open(`${name}2`)
    next.E.setKeepScope('s')
    const got = await next.E.recoverPending(next.qc, next.held() as never)
    if (got && 'ask' in got) next.E.restorePending(next.qc, next.held() as never, got.ask)
    await next.drain()
    for (const d of server.history) next.frame(d)
    await next.drain()
    assert.deepEqual(texts(server.doc.ptBody), ['Above', 'x', 'y', 'zStart text one two three', 'Below'])
    assert.deepEqual(texts(next.held().ptBody), texts(server.doc.ptBody), 'the page shows what is stored')
    server.gone.add(`?page=${name}2`)
  })
