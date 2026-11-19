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
const {applyPaths, setPath} = await import('./paths.ts')

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

/** Barkpark, one document: revisions, the field fence, live frames, faults to order. */
class Server {
  doc!: Doc
  history: Doc[] = []
  n = 0
  /** For the next writes, in order: refused with a 500, landed with its answer lost, held until `release`. */
  faults: ('500' | 'lost' | 'hold')[] = []
  release = () => {}
  /** Pages that are gone (reloaded): their calls never answer. */
  gone = new Set<string>()
  onRead?: () => void
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
  async fetch(page: string, _url: string, init: {body: string}) {
    if (this.gone.has(page)) return new Promise(() => {})
    const fault = this.faults.shift()
    if (fault === 'hold') await new Promise<void>((go) => (this.release = go))
    if (fault === '500') return answer(500, {error: {code: 'internal_error', message: 'Internal Server Error'}})
    let doc: Record<string, unknown> = this.doc
    for (const m of JSON.parse(init.body).mutations as {patch: {ifRevisionID?: string; fence?: string; set?: Record<string, unknown>; unset?: string[]; diffMatchPatch?: unknown}}[]) {
      const p = m.patch
      assert.equal(p.diffMatchPatch, undefined, 'span patches are not used here')
      if (p.ifRevisionID) {
        const at = this.history.find((h) => h._rev === p.ifRevisionID)
        const roots = [...Object.keys(p.set ?? {}), ...(p.unset ?? [])].map((f) => f.split(/[.[]/)[0]!)
        // Barkpark's field fence: a stale rev passes when the fields it writes are unchanged since.
        const ok = p.fence === 'fields' ? !!at && roots.every((f) => J(at[f]) === J(doc[f])) : p.ifRevisionID === this.doc._rev
        if (!ok) return answer(412, {error: {code: 'precondition_failed', message: 'document revision mismatch'}})
      }
      doc = applyPaths(doc, Object.entries(p.set ?? {}))
      for (const u of p.unset ?? []) doc = setPath(doc, u, undefined)
    }
    const saved = this.stamp(doc, page)
    if (fault === 'lost') throw new TypeError('fetch failed')
    return answer(200, {transactionId: saved._rev, results: [{id: ID, operation: 'update', document: saved}]})
  }
}
const answer = (status: number, body: unknown) => ({ok: status < 300, status, json: async () => body})

let server: Server
;(globalThis as Record<string, unknown>).saveFlowServer = {
  fetch: (page: string, ...a: [string, {body: string}]) => server.fetch(page, ...a),
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
  return {name, E, qc, held, save, drain, frame: (d: Doc) => E.applyServer(qc, clone(d) as never)}
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
