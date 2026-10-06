import {useSyncExternalStore} from 'react'
import type {QueryClient} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset, requestToken} from '../server/barkpark'
import {expectEcho, mutatedIds} from '../server/listen'
import {docQuery, type Doc, type ListPage} from './data'
import {merge3, unapply} from './merge'
import {applyPaths, getPath, setPath, within} from './paths'

// Local-first editing. A keystroke writes the query cache at once (input, pane
// title, list row all repaint with no network wait); the write goes to Barkpark
// behind it. Writes are coalesced per document: at most one patch every
// WRITE_GAP_MS (the first after a pause goes at once), one in flight, later
// values for a field replacing earlier ones. Leaving a field, closing a pane or
// the page flushes. Interim for task-2c31de0cf6597d32: every editor shares the
// server token's 60 writes/min. Server truth (mutate responses, live frames) is folded
// back in under whatever is still unsent, and never older than what we hold.
//
// Concurrent edits (J05, J06): every patch carries the rev it was made against
// (ifRevisionID). Someone else wrote first → 412 → read theirs, rebase ours on it
// (text fields merge with diff-match-patch, other values: ours wins), send again.
// A live frame that changes a field being typed in rebases it the same way at once.

type Json = string | number | boolean | null | Json[] | {[k: string]: Json}

export const mutate = createServerFn({method: 'POST'})
  .validator((d: {mutations: Json[]}) => d)
  .handler(async ({data}) => {
    const res = await bpFetch(`/v1/data/mutate/${dataset()}`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({mutations: data.mutations}),
    })
    const body = (await res.json().catch(() => ({}))) as Json
    if (!res.ok) throw new Error(`mutate ${res.status}: ${JSON.stringify(body).slice(0, 300)}`)
    expectEcho(requestToken(), mutatedIds(data.mutations))
    return body
  })

/**
 * J20: what the footer says about saving. `offline`: the browser has no network, so
 * nothing is sent and every edit stays here; `stalled`: a write has been on its way
 * longer than STALL_MS; `recovering`: back online, sending what was kept; `error`:
 * a failed write, retried. And (task-ccd1876176b0fc08, J48) two that stop writing
 * and keep every edit: `signedOut` — the session is gone, nothing is sent until the
 * editor signs in again (resumeSaving); `refused` — Barkpark said no (403, e.g.
 * read-only), with its reason; the next edit tries again, nothing retries on its own.
 */
export type SaveState = 'saved' | 'saving' | 'stalled' | 'offline' | 'recovering' | 'error' | 'signedOut' | 'refused'
type Snap = {state: SaveState; error?: string}
type DocEdits = {
  type: string
  dirty: Map<string, unknown>
  inflight: Map<string, unknown> | null
  snap: Snap
  lastSent: number
  timer?: ReturnType<typeof setTimeout>
  /** A new doc that exists only here: its first write creates it with these values. */
  pendingCreate?: Record<string, unknown>
  /** The server rev our unsent edits are made against (sent as ifRevisionID). */
  rev?: string
  /** For each field with edits in dirty or inflight: the server value they were made from. */
  base: Map<string, unknown>
  /** Rebases in a row (a guard against a write that never gets through). */
  conflicts: number
  /** This editor's own changes, for Mod+Z / Mod+Shift+Z (F7). */
  undo: Change[]
  redo: Change[]
}

/**
 * One of this editor's own changes: typing in one field within UNDO_GROUP_MS is one
 * change, kept as its keystrokes (each from the value as it stood then, so someone
 * else's text merged in between is never part of a step).
 */
type Change = {field: string; steps: {before: unknown; after: unknown}[]; at: number}
const UNDO_GROUP_MS = 600

export const WRITE_GAP_MS = 750
const STALL_MS = 4000
const OFFLINE_RETRY_MS = 5000

const online = () => typeof navigator === 'undefined' || navigator.onLine
const isNetworkError = (err: unknown) => !online() || err instanceof TypeError || /failed to fetch|networkerror|load failed|fetch failed/i.test(String((err as Error)?.message))
// Docs waiting for the network to come back: each sends again on the 'online' event.
const waiting = new Map<string, () => void>()
if (typeof window !== 'undefined') {
  addEventListener('online', () => {
    const go = [...waiting.values()]
    waiting.clear()
    go.forEach((f) => f())
  })
  // Leaving while offline with edits not sent would lose them (the unload beacon
  // can't go out either): the browser asks first.
  addEventListener('beforeunload', (ev) => {
    if (online() || ![...docs.values()].some((d) => d.dirty.size || d.inflight)) return
    ev.preventDefault()
    ev.returnValue = ''
  })
}

const SAVED: Snap = {state: 'saved'}
const docs = new Map<string, DocEdits>()
const listeners = new Set<() => void>()
const setState = (e: DocEdits, state: SaveState, error?: string) => {
  e.snap = {state, error}
  listeners.forEach((l) => l())
}

const entry = (id: string, type: string) => {
  let e = docs.get(id)
  if (!e) docs.set(id, (e = {type, dirty: new Map(), inflight: null, snap: SAVED, lastSent: 0, base: new Map(), conflicts: 0, undo: [], redo: []}))
  return e
}

/** `doc` with the values typed here that the server has not confirmed yet on top (keys may be paths). */
function overlay(id: string, doc: Doc): Doc {
  const e = docs.get(id)
  return e ? applyPaths(applyPaths(doc, e.inflight ?? []), e.dirty) : doc
}

function writeCache(qc: QueryClient, id: string, type: string, doc: Doc) {
  qc.setQueryData(['doc', id], doc)
  qc.setQueriesData<ListPage>({queryKey: ['list', type]}, (page) => page && {...page, docs: [doc, ...page.docs.filter((d) => d._publishedId !== id)]})
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

/** Move our unsent edits onto server doc `d`: fields someone else changed meanwhile merge. */
function rebase(e: DocEdits, d: Doc) {
  e.rev = d._rev
  for (const [f, base] of e.base) {
    const theirs = getPath(d, f)
    if (same(theirs, base)) continue
    // Our own write coming back is not someone else's change.
    if (e.inflight?.has(f) && same(theirs, e.inflight.get(f))) {
      e.base.set(f, theirs)
      continue
    }
    // An inflight-only field waits for its 412; a dirty one merges now.
    if (!e.dirty.has(f)) continue
    const mine = e.dirty.get(f)
    if (typeof base === 'string' && typeof mine === 'string' && typeof theirs === 'string') e.dirty.set(f, merge3(base, mine, theirs))
    e.base.set(f, theirs)
  }
}

/** Fold server truth into the cache: skip it when older than what we hold, keep unsent edits on top. */
export function applyServer(qc: QueryClient, doc: Doc) {
  const id = doc._publishedId
  const held = qc.getQueryData<Doc | null>(['doc', id])
  if (held && held._updatedAt > doc._updatedAt) return
  const e = docs.get(id)
  if (e) rebase(e, doc)
  // A published row (or a publish) proves a published version; a draft keeps what we knew.
  const _hasPublished = !doc._draft || (doc._hasPublished ?? held?._hasPublished ?? false)
  writeCache(qc, id, doc._type, overlay(id, {...doc, _hasPublished} as Doc))
}

/** `field` is a field name or a dotted path into an object ("seo.metaTitle"): only that path is sent. */
export function edit(qc: QueryClient, doc: Doc, field: string, value: unknown, record = true) {
  const id = doc._publishedId
  const e = entry(id, doc._type)
  const held = qc.getQueryData<Doc>(['doc', id]) ?? doc
  if (record) {
    const step = {before: getPath(held, field), after: value}
    const last = e.undo.at(-1)
    if (last?.field === field && Date.now() - last.at < UNDO_GROUP_MS) (last.steps.push(step), (last.at = Date.now()))
    else e.undo.push({field, steps: [step], at: Date.now()})
    e.redo = []
  }
  // What this edit is made against: the server's value (and rev) as this browser has it.
  if (!e.dirty.size && !e.inflight) e.rev = held._rev || undefined
  const pending = [...e.base.keys()].some((k) => within(field, k) || within(k, field))
  if (!pending) e.base.set(field, getPath(held, field))
  // One pending write per spot: a path inside an object already pending whole goes
  // into that value; a whole value replaces the paths pending inside it.
  const outer = [...e.dirty.keys()].find((k) => k !== field && within(field, k))
  if (outer) e.dirty.set(outer, setPath({[outer]: e.dirty.get(outer)}, field, value)[outer])
  else {
    for (const k of [...e.dirty.keys()]) if (k !== field && within(k, field)) e.dirty.delete(k)
    e.dirty.set(field, value)
  }
  // An edit makes (or updates) the draft: show it as one now.
  writeCache(qc, id, doc._type, setPath({...held, _draft: true} as Doc, field, value))
  if (e.snap.state === 'saved') setState(e, 'saving')
  // Signed out: hold it with the rest until the editor signs in again.
  if (e.snap.state === 'signedOut') return
  schedule(qc, id)
}

/** Send now if the last write was WRITE_GAP_MS ago, else once that gap has passed. */
function schedule(qc: QueryClient, id: string) {
  const e = docs.get(id)
  if (!e || e.timer || e.dirty.size === 0) return
  const wait = Math.max(0, e.lastSent + WRITE_GAP_MS - Date.now())
  if (wait === 0) void send(qc, id)
  else e.timer = setTimeout(() => ((e.timer = undefined), void send(qc, id)), wait)
}

/**
 * Undo (or redo) this editor's last own change, Sanity's Mod+Z, on top of whatever
 * the doc holds now: someone else's edits since stay (text reverts by patch). Returns
 * the field it changed, for focus.
 */
export function undo(qc: QueryClient, id: string, back = true): string | undefined {
  const e = docs.get(id)
  const doc = qc.getQueryData<Doc>(['doc', id])
  const change = (back ? e?.undo : e?.redo)?.pop()
  if (!e || !doc || !change) return
  const steps = back ? [...change.steps].reverse().map((x) => [x.after, x.before] as const) : change.steps.map((x) => [x.before, x.after] as const)
  let now = getPath(doc, change.field)
  for (const [from, to] of steps) now = typeof from === 'string' && typeof to === 'string' && typeof now === 'string' ? unapply(from, to, now) : to
  edit(qc, doc, change.field, now, false)
  ;(back ? e.redo : e.undo).push({...change, at: 0})
  return change.field
}

/** Send whatever is waiting right away (field blur, pane close). */
export function flush(qc: QueryClient, id: string) {
  const e = docs.get(id)
  if (!e) return
  clearTimeout(e.timer)
  e.timer = undefined
  void send(qc, id)
}

/** Page is going away: hand every unsent change to the browser to deliver. */
export function flushOnUnload() {
  const mutations = [...docs].flatMap(([id, e]) => {
    if (e.dirty.size === 0) return []
    const {set, unset} = toPatch(e.dirty)
    return [e.pendingCreate ? {create: {_id: id, _type: e.type, ...applyPaths(e.pendingCreate as Record<string, Json>, e.dirty)}} : {patch: {id, type: e.type, set, unset}}]
  })
  if (mutations.length) navigator.sendBeacon('/api/mutate', new Blob([JSON.stringify({mutations})], {type: 'application/json'}))
}

function toPatch(fields: Map<string, unknown>) {
  const set: Record<string, Json> = {}
  const unset: string[] = []
  for (const [k, v] of fields) {
    const empty = v === '' || v === undefined || v === null
    // Barkpark keeps `title` as a row column: `unset` leaves it, `set ""` clears it.
    if (empty && k === 'title') set[k] = ''
    else if (empty) unset.push(k)
    else set[k] = v as Json
  }
  return {set, unset}
}

/** Barkpark's own reason, from a thrown "mutate 403: {error: {message}}". */
function reasonOf(msg: string): string | undefined {
  try {
    const body = JSON.parse(msg.slice(msg.indexOf('{'))) as {error?: {message?: string; hint?: string}}
    return body.error?.message
  } catch {
    return undefined
  }
}

/** After signing in again: send every doc's edits that waited for it. */
export function resumeSaving(qc: QueryClient) {
  for (const [id, e] of docs) if (e.snap.state === 'signedOut' && e.dirty.size) (setState(e, 'saving'), void send(qc, id))
}

/** Offline: hold everything, send again when the network is back (or try every few seconds). */
function waitForNetwork(qc: QueryClient, id: string, e: DocEdits) {
  setState(e, 'offline')
  waiting.set(id, () => void send(qc, id))
  setTimeout(() => waiting.has(id) && online() && (waiting.delete(id), void send(qc, id)), OFFLINE_RETRY_MS)
}

async function send(qc: QueryClient, id: string) {
  const e = docs.get(id)
  if (!e || e.inflight || e.dirty.size === 0) return
  // Signed out: nothing goes until the editor is back (resumeSaving) — not even a flush on blur.
  if (e.snap.state === 'signedOut') return
  if (!online()) return waitForNetwork(qc, id, e)
  e.inflight = e.dirty
  e.dirty = new Map()
  e.lastSent = Date.now()
  const after = e.snap.state === 'offline' || e.snap.state === 'recovering'
  setState(e, after ? 'recovering' : 'saving')
  const stall = setTimeout(() => e.inflight && setState(e, 'stalled'), STALL_MS)
  const {set, unset} = toPatch(e.inflight)
  const creating = e.pendingCreate
  try {
    const mutation: Json = creating
      ? {create: {_id: id, _type: e.type, ...applyPaths(creating as Record<string, Json>, e.inflight)}}
      : {patch: {id, type: e.type, set, unset, ...(e.rev ? {ifRevisionID: e.rev} : {})}}
    const r = (await mutate({data: {mutations: [mutation]}})) as {results: {document: Doc}[]}
    const saved = r.results[0].document
    if (creating) e.pendingCreate = undefined
    // What we sent is now the server's: a field still being typed builds on it.
    for (const f of e.inflight.keys()) {
      if (e.dirty.has(f)) e.base.set(f, getPath(saved, f))
      else e.base.delete(f)
    }
    e.inflight = null
    e.conflicts = 0
    clearTimeout(stall)
    applyServer(qc, saved)
    setState(e, e.dirty.size ? 'saving' : 'saved')
  } catch (err) {
    clearTimeout(stall)
    const msg = (err as Error).message ?? ''
    // Signed out, or not allowed: keep every value, say why, stop writing.
    if (/^mutate 401\b/.test(msg) || /session_lost/.test(msg)) {
      e.dirty = new Map([...e.inflight!, ...e.dirty])
      e.inflight = null
      return setState(e, 'signedOut', "You've been logged out")
    }
    if (/^mutate 403\b/.test(msg)) {
      e.dirty = new Map([...e.inflight!, ...e.dirty])
      e.inflight = null
      return setState(e, 'refused', reasonOf(msg) ?? 'Barkpark refused the change')
    }
    // No network: keep every value and wait for it, no error, no retry storm.
    if (isNetworkError(err)) {
      e.dirty = new Map([...e.inflight!, ...e.dirty])
      e.inflight = null
      return waitForNetwork(qc, id, e)
    }
    // Someone else wrote first (stale rev; or both forked the draft at once,
    // task-324b4d00706a6cfb): read theirs, rebase ours onto it, send again.
    if (!creating && /^mutate (409|412)\b|already been taken/.test((err as Error).message) && e.conflicts++ < 5) {
      try {
        const latest = await qc.fetchQuery({...docQuery(e.type, id), staleTime: 0})
        e.dirty = new Map([...e.inflight!, ...e.dirty])
        e.inflight = null
        if (latest) {
          rebase(e, latest)
          writeCache(qc, id, e.type, overlay(id, latest))
        }
        void send(qc, id)
        return
      } catch {
        // fall through: a plain failure, retried below
      }
    }
    // Keep every value: put the failed batch back under anything typed since, retry.
    e.dirty = new Map([...e.inflight!, ...e.dirty])
    e.inflight = null
    setState(e, 'error', (err as Error).message)
    setTimeout(() => void send(qc, id), 2000)
    return
  }
  schedule(qc, id)
}

/**
 * A new doc, Sanity-style: it opens at once with its initial values but exists
 * only here until the first edit, which creates it. Leaving untouched leaves
 * nothing behind.
 */
export function draftNew(qc: QueryClient, type: string, id: string, initial: Record<string, unknown>) {
  const e = entry(id, type)
  if (qc.getQueryData(['doc', id])) return
  e.pendingCreate = initial
  qc.setQueryData(['doc', id], {_id: `drafts.${id}`, _publishedId: id, _type: type, _draft: true, _hasPublished: false, _rev: '', _updatedAt: '', ...initial} as Doc)
}

/**
 * Create a draft now and hold every edit to it until the server has it. The
 * cache gets the doc at once (a pane can open on it in the same frame); its
 * empty _updatedAt lets the server's copy replace it.
 */
export async function createDoc(qc: QueryClient, type: string, id: string, fields: Record<string, unknown>) {
  const e = entry(id, type)
  writeCache(qc, id, type, {_id: `drafts.${id}`, _publishedId: id, _type: type, _draft: true, _hasPublished: false, _rev: '', _updatedAt: '', ...fields} as Doc)
  e.inflight = new Map(Object.entries(fields))
  setState(e, 'saving')
  try {
    const r = (await mutate({data: {mutations: [{create: {_id: id, _type: type, ...(fields as Record<string, Json>)}}]}})) as {results: {document: Doc}[]}
    e.inflight = null
    applyServer(qc, r.results[0].document)
    setState(e, e.dirty.size ? 'saving' : 'saved')
    schedule(qc, id)
  } catch (err) {
    e.inflight = null
    setState(e, 'error', (err as Error).message)
    throw err
  }
}

/** Resolves once nothing typed into `id` is waiting or in flight. */
export function whenSaved(id: string): Promise<void> {
  const idle = () => {
    const e = docs.get(id)
    return !e || (!e.inflight && !e.timer && e.dirty.size === 0)
  }
  if (idle()) return Promise.resolve()
  return new Promise((resolve) => {
    const check = () => idle() && (listeners.delete(check), resolve())
    listeners.add(check)
  })
}

/** Publish what the editor sees: unsent edits go first. */
export async function publish(qc: QueryClient, doc: Doc) {
  const id = doc._publishedId
  flush(qc, id)
  await whenSaved(id)
  if (!qc.getQueryData<Doc>(['doc', id])?._draft) return // nothing to publish
  const r = (await mutate({data: {mutations: [{publish: {id, type: doc._type}}]}})) as {results: {document: Doc}[]}
  applyServer(qc, r.results[0].document)
  qc.setQueryData(['doc-published', id], r.results[0].document)
}

export function useSaveState(id: string): Snap {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => docs.get(id)?.snap ?? SAVED,
    () => SAVED,
  )
}

/** Delete a document (draft and published). The server is the judge of whether it may. */
export async function deleteDoc(qc: QueryClient, doc: Doc) {
  const id = doc._publishedId
  await mutate({data: {mutations: [{delete: {id, type: doc._type}}]}})
  docs.delete(id)
  qc.setQueriesData<ListPage>({queryKey: ['list', doc._type]}, (page) => page && {...page, docs: page.docs.filter((d) => d._publishedId !== id)})
  qc.removeQueries({queryKey: ['doc', id]})
}

/** Unpublish: the published version goes; its content stays on as the draft. */
export async function unpublish(qc: QueryClient, doc: Doc) {
  const id = doc._publishedId
  flush(qc, id)
  await whenSaved(id)
  const r = (await mutate({data: {mutations: [{unpublish: {id, type: doc._type}}]}})) as {results: {document: Doc}[]}
  writeCache(qc, id, doc._type, overlay(id, {...r.results[0].document, _hasPublished: false} as Doc))
  qc.setQueryData(['doc-published', id], null)
}

/** Discard the draft: back to the published version; anything unsent is dropped too. */
export async function discardDraft(qc: QueryClient, doc: Doc) {
  const id = doc._publishedId
  const e = docs.get(id)
  if (e) (clearTimeout(e.timer), (e.timer = undefined), e.dirty.clear())
  await whenSaved(id)
  await mutate({data: {mutations: [{discardDraft: {id, type: doc._type}}]}})
  const published = qc.getQueryData<Doc | null>(['doc-published', id])
  if (published) writeCache(qc, id, doc._type, {...published, _hasPublished: true} as Doc)
  await qc.invalidateQueries({queryKey: ['doc', id]})
}
