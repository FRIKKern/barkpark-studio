import {useSyncExternalStore} from 'react'
import type {QueryClient} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset} from '../server/barkpark'
import type {Doc} from './data'

// Local-first editing. A keystroke writes the query cache at once (input, pane
// title, list row all repaint with no network wait); the write goes to Barkpark
// behind it. Writes are coalesced per document: at most one patch every
// WRITE_GAP_MS (the first after a pause goes at once), one in flight, later
// values for a field replacing earlier ones. Leaving a field, closing a pane or
// the page flushes. Interim for task-2c31de0cf6597d32: every editor shares the
// server token's 60 writes/min. Server truth (mutate responses, live frames) is folded
// back in under whatever is still unsent, and never older than what we hold.

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
    return body
  })

export type SaveState = 'saved' | 'saving' | 'error'
type Snap = {state: SaveState; error?: string}
type DocEdits = {type: string; dirty: Map<string, unknown>; inflight: Map<string, unknown> | null; snap: Snap; lastSent: number; timer?: ReturnType<typeof setTimeout>}

export const WRITE_GAP_MS = 750

const SAVED: Snap = {state: 'saved'}
const docs = new Map<string, DocEdits>()
const listeners = new Set<() => void>()
const setState = (e: DocEdits, state: SaveState, error?: string) => {
  e.snap = {state, error}
  listeners.forEach((l) => l())
}

const entry = (id: string, type: string) => {
  let e = docs.get(id)
  if (!e) docs.set(id, (e = {type, dirty: new Map(), inflight: null, snap: SAVED, lastSent: 0}))
  return e
}

/** Values typed here that the server has not confirmed yet. */
function overlay(id: string): Record<string, unknown> {
  const e = docs.get(id)
  return e ? {...Object.fromEntries(e.inflight ?? []), ...Object.fromEntries(e.dirty)} : {}
}

function writeCache(qc: QueryClient, id: string, type: string, doc: Doc) {
  qc.setQueryData(['doc', id], doc)
  qc.setQueryData(['list', type], (list: Doc[] | undefined) => list && [doc, ...list.filter((d) => d._publishedId !== id)])
}

/** Fold server truth into the cache: skip it when older than what we hold, keep unsent edits on top. */
export function applyServer(qc: QueryClient, doc: Doc) {
  const id = doc._publishedId
  const held = qc.getQueryData<Doc | null>(['doc', id])
  if (held && held._updatedAt > doc._updatedAt) return
  // A published row (or a publish) proves a published version; a draft keeps what we knew.
  const _hasPublished = !doc._draft || (doc._hasPublished ?? held?._hasPublished ?? false)
  writeCache(qc, id, doc._type, {...doc, _hasPublished, ...overlay(id)} as Doc)
}

export function edit(qc: QueryClient, doc: Doc, field: string, value: unknown) {
  const id = doc._publishedId
  const e = entry(id, doc._type)
  e.dirty.set(field, value)
  const held = qc.getQueryData<Doc>(['doc', id]) ?? doc
  writeCache(qc, id, doc._type, {...held, [field]: value} as Doc)
  if (e.snap.state === 'saved') setState(e, 'saving')
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
    return [{patch: {id, type: e.type, set, unset}}]
  })
  if (mutations.length) navigator.sendBeacon('/api/mutate', new Blob([JSON.stringify({mutations})], {type: 'application/json'}))
}

function toPatch(fields: Map<string, unknown>) {
  const set: Record<string, Json> = {}
  const unset: string[] = []
  for (const [k, v] of fields) (v === '' || v === undefined || v === null ? unset.push(k) : (set[k] = v as Json))
  return {set, unset}
}

async function send(qc: QueryClient, id: string) {
  const e = docs.get(id)
  if (!e || e.inflight || e.dirty.size === 0) return
  e.inflight = e.dirty
  e.dirty = new Map()
  e.lastSent = Date.now()
  setState(e, 'saving')
  const {set, unset} = toPatch(e.inflight)
  try {
    const r = (await mutate({data: {mutations: [{patch: {id, type: e.type, set, unset}}]}})) as {results: {document: Doc}[]}
    e.inflight = null
    applyServer(qc, r.results[0].document)
    setState(e, e.dirty.size ? 'saving' : 'saved')
  } catch (err) {
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

export async function publish(qc: QueryClient, doc: Doc) {
  const id = doc._publishedId
  const r = (await mutate({data: {mutations: [{publish: {id, type: doc._type}}]}})) as {results: {document: Doc}[]}
  applyServer(qc, r.results[0].document)
}

export function useSaveState(id: string): Snap {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => docs.get(id)?.snap ?? SAVED,
    () => SAVED,
  )
}
