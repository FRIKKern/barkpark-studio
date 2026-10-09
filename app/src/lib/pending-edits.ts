import type {Doc, Schema} from './data'
import {merge3} from './merge.ts'
import {getPath} from './paths.ts'

// B11 widen, after the canvas's kept words (D21, lib/kept-words.ts): form edits not yet
// acknowledged by Barkpark are kept in this browser's IndexedDB as they are typed, so a
// reload or a crash loses nothing. One entry per page and document, per workspace,
// project, dataset and editor (two tabs on one doc never overwrite or clear each other's);
// cleared when Barkpark has them. On open: the server rev unchanged
// → they are sent again quietly; changed → the pane asks (Restore / Discard).
// Every IndexedDB call is wrapped: private mode or a blocked store only means nothing is kept.

export type Pending = {
  at: number
  type: string
  /** The server rev the edits were made against. */
  rev?: string
  /** Field path → value typed here. */
  fields: [string, unknown][]
  /** Field path → the server value it was made from (for a text merge on restore). */
  base: [string, unknown][]
  /** The page that wrote it: a page still open owns it (its Web Lock is held). */
  tab: string
}

const DB = 'bp-pending-edits'
const STORE = 'docs'
/** This page's id; it holds a Web Lock by this name for as long as it is open. */
export const TAB = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random())
const LOCK = (tab: string) => `bp-tab-${tab}`
if (typeof navigator !== 'undefined') {
  try {
    void navigator.locks?.request(LOCK(TAB), () => new Promise<void>(() => {}))
  } catch {}
}

let db: Promise<IDBDatabase | null> | undefined
function open(): Promise<IDBDatabase | null> {
  return (db ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  }))
}

function run<T>(mode: IDBTransactionMode, go: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return open().then(
    (d) =>
      new Promise((resolve) => {
        if (!d) return resolve(null)
        try {
          const req = go(d.transaction(STORE, mode).objectStore(STORE))
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => resolve(null)
        } catch {
          resolve(null)
        }
      }),
  )
}

/** This page's entry for a doc; `docKey` alone is an entry from before entries were per page. */
export const pendingKey = (docKey: string, tab = TAB) => `${docKey}|${tab}`
export const putPending = (key: string, p: Pending) => run('readwrite', (s) => s.put(p, key)).then(() => {})
export const dropPending = (key: string) => run('readwrite', (s) => s.delete(key)).then(() => {})
export const readPending = (key: string) => run<Pending | undefined>('readonly', (s) => s.get(key)).then((p) => (p && Array.isArray(p.fields) ? p : null))

/** Every entry kept for one doc, any page's, oldest first. */
export async function readDocPending(docKey: string): Promise<[string, Pending][]> {
  const range = (() => {
    try {
      return IDBKeyRange.bound(`${docKey}|`, `${docKey}|\uffff`)
    } catch {
      return null
    }
  })()
  if (!range) return []
  const [keys, values, legacy] = await Promise.all([run('readonly', (s) => s.getAllKeys(range)), run('readonly', (s) => s.getAll(range)), readPending(docKey)])
  const all: [string, Pending][] = (keys ?? []).map((k, i) => [String(k), values?.[i] as Pending])
  if (legacy) all.push([docKey, legacy])
  return all.filter(([, p]) => p && Array.isArray(p.fields)).sort((a, b) => a[1].at - b[1].at)
}

/**
 * Several dead pages' entries for one doc as one: a later edit of a field wins, with the
 * base it was made from; the rev only when all were made against the same one.
 */
export function combine(entries: Pending[]): Pending | null {
  if (!entries.length) return null
  const fields = new Map<string, unknown>()
  const base = new Map<string, unknown>()
  for (const p of entries) {
    const from = new Map(p.base)
    for (const [f, v] of p.fields) fields.set(f, v), base.set(f, from.get(f))
  }
  const last = entries[entries.length - 1]!
  const rev = entries.every((p) => p.rev === last.rev) ? last.rev : undefined
  return {at: last.at, type: last.type, rev, fields: [...fields], base: [...base], tab: last.tab}
}

const KIND: Record<string, string> = {string: 'string', text: 'string', url: 'string', email: 'string', slug: 'object', number: 'number', boolean: 'boolean'}
/** Whether a kept value still has a home in the schema: its field is there, and of a kind that takes it. */
export function fits(schema: Schema | undefined, path: string, value: unknown): boolean {
  if (!schema) return true
  const field = schema.fields.find((f) => f.name === path.split(/[.[]/)[0])
  if (!field) return false
  const kind = path === field.name ? KIND[field.type] : undefined
  return !kind || value === null || value === undefined || typeof value === kind
}

/** Whether the page that wrote `p` is still open (then it is that page's, not ours to offer). */
export async function ownedElsewhere(p: Pending): Promise<boolean> {
  if (p.tab === TAB) return false
  try {
    const held = (await navigator.locks?.query())?.held ?? []
    return held.some((l) => l.name === LOCK(p.tab))
  } catch {
    return false
  }
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

/**
 * What to do with `p` against the document as the server has it now: `replay` (same rev:
 * nothing changed underneath), `ask` (someone saved since) with the fields still
 * different, or `drop` (the server already says all of it, e.g. the page's last beacon got
 * through).
 */
export function judge(p: Pending, doc: Doc, schema?: Schema): {kind: 'replay' | 'ask'; fields: [string, unknown][]; gone?: string[]} | {kind: 'drop'} {
  const differ = p.fields.filter(([f, v]) => !same(getPath(doc, f), v))
  // A field the schema dropped or retyped since: never sent (the form no longer shows it
  // as it was), and never forgotten without a word: the pane asks, naming it.
  const gone = differ.filter(([f, v]) => !fits(schema, f, v)).map(([f]) => f)
  const fields = differ.filter(([f]) => !gone.includes(f))
  if (!fields.length && !gone.length) return {kind: 'drop'}
  if (gone.length) return {kind: 'ask', fields, gone}
  return {kind: p.rev && p.rev === doc._rev ? 'replay' : 'ask', fields}
}

/** Restore over what the server has now: text merges with what changed since, anything else is ours. */
export function restoreValue(p: Pending, field: string, mine: unknown, doc: Doc): unknown {
  const base = new Map(p.base).get(field)
  const theirs = getPath(doc, field)
  return typeof base === 'string' && typeof mine === 'string' && typeof theirs === 'string' ? merge3(base, mine, theirs) : mine
}
