import {useSyncExternalStore} from 'react'
import type {QueryClient} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset} from '../server/barkpark'
import type {Doc} from './data'

// Local-first editing. A keystroke writes the query cache at once (input, pane
// title, list row all repaint with no network wait); the write goes to Barkpark
// behind it, one request in flight per document, everything typed meanwhile
// riding the next one. Server truth (mutate responses, live frames) is folded
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
type DocEdits = {type: string; dirty: Map<string, unknown>; inflight: Map<string, unknown> | null; snap: Snap}

const SAVED: Snap = {state: 'saved'}
const docs = new Map<string, DocEdits>()
const listeners = new Set<() => void>()
const setState = (e: DocEdits, state: SaveState, error?: string) => {
  e.snap = {state, error}
  listeners.forEach((l) => l())
}

const entry = (id: string, type: string) => {
  let e = docs.get(id)
  if (!e) docs.set(id, (e = {type, dirty: new Map(), inflight: null, snap: SAVED}))
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
  writeCache(qc, id, doc._type, {...doc, ...overlay(id)} as Doc)
}

export function edit(qc: QueryClient, doc: Doc, field: string, value: unknown) {
  const id = doc._publishedId
  const e = entry(id, doc._type)
  e.dirty.set(field, value)
  const held = qc.getQueryData<Doc>(['doc', id]) ?? doc
  writeCache(qc, id, doc._type, {...held, [field]: value} as Doc)
  void send(qc, id)
}

async function send(qc: QueryClient, id: string) {
  const e = docs.get(id)
  if (!e || e.inflight || e.dirty.size === 0) return
  e.inflight = e.dirty
  e.dirty = new Map()
  setState(e, 'saving')
  const set: Record<string, Json> = {}
  const unset: string[] = []
  for (const [k, v] of e.inflight) (v === '' || v === undefined || v === null ? unset.push(k) : (set[k] = v as Json))
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
  void send(qc, id)
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
