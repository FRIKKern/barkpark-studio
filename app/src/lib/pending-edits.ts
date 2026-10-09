import type {Doc} from './data'
import {merge3} from './merge.ts'
import {getPath} from './paths.ts'

// B11 widen, after the canvas's kept words (D21, lib/kept-words.ts): form edits not yet
// acknowledged by Barkpark are kept in this browser's IndexedDB as they are typed, so a
// reload or a crash loses nothing. One entry per document, per workspace, project,
// dataset and editor; cleared when Barkpark has them. On open: the server rev unchanged
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

export const pendingKey = (scope: string, id: string) => `${scope}|${id}`
export const putPending = (key: string, p: Pending) => run('readwrite', (s) => s.put(p, key)).then(() => {})
export const dropPending = (key: string) => run('readwrite', (s) => s.delete(key)).then(() => {})
export const readPending = (key: string) => run<Pending | undefined>('readonly', (s) => s.get(key)).then((p) => (p && Array.isArray(p.fields) ? p : null))

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
export function judge(p: Pending, doc: Doc): {kind: 'replay' | 'ask'; fields: [string, unknown][]} | {kind: 'drop'} {
  const fields = p.fields.filter(([f, v]) => !same(getPath(doc, f), v))
  if (!fields.length) return {kind: 'drop'}
  return {kind: p.rev && p.rev === doc._rev ? 'replay' : 'ask', fields}
}

/** Restore over what the server has now: text merges with what changed since, anything else is ours. */
export function restoreValue(p: Pending, field: string, mine: unknown, doc: Doc): unknown {
  const base = new Map(p.base).get(field)
  const theirs = getPath(doc, field)
  return typeof base === 'string' && typeof mine === 'string' && typeof theirs === 'string' ? merge3(base, mine, theirs) : mine
}
