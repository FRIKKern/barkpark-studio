import type {Doc, Schema} from './data'
import {merge3, mergeList3} from './merge.ts'
import {getPath} from './paths.ts'
import {keptReach} from './kept-stands.ts'
import {isText, keyOf, textOf} from './pt-merge.ts'

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
  /**
   * List field → its block keys where a block of it kept by its key was made: a restore's run
   * goes on only over blocks new since (restoreBlock). Absent in entries kept before it was.
   */
  keys?: [string, string[]][]
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
/** `p` with only the edits to `fields` (and their bases): what stays kept when those were not put back. */
export const keptOnly = (p: Pending, fields: string[]): Pending => ({...p, fields: p.fields.filter(([f]) => fields.includes(f)), base: p.base.filter(([f]) => fields.includes(f))})

/**
 * After a put-back of the dead pages' kept edits (their `keys`, combined as `p`): what is kept and
 * what goes. The edits to `refused` fields are kept first, under the page that made them, then the
 * rest of the keys go, so nothing is lost if the page closes in between.
 */
export function keepPlan(docKey: string | undefined, keys: string[], p: Pending, refused: string[]): {keep?: [string, Pending]; drop: string[]} {
  const at = docKey && refused.length ? pendingKey(docKey, p.tab) : undefined
  return {...(at && {keep: [at, keptOnly(p, refused)] as [string, Pending]}), drop: keys.filter((k) => k !== at)}
}

export function combine(entries: Pending[]): Pending | null {
  if (!entries.length) return null
  const fields = new Map<string, unknown>()
  const base = new Map<string, unknown>()
  // A key any entry knew is not new to the run (restoreBlock).
  const keys = new Map<string, Set<string>>()
  for (const p of entries) {
    const from = new Map(p.base)
    for (const [f, v] of p.fields) fields.set(f, v), base.set(f, from.get(f))
    for (const [root, ks] of p.keys ?? []) for (const k of ks) (keys.get(root) ?? keys.set(root, new Set()).get(root)!).add(k)
  }
  const last = entries[entries.length - 1]!
  const rev = entries.every((p) => p.rev === last.rev) ? last.rev : undefined
  const known = keys.size ? {keys: [...keys].map(([root, ks]) => [root, [...ks]] as [string, string[]])} : {}
  return {at: last.at, type: last.type, rev, fields: [...fields], base: [...base], ...known, tab: last.tab}
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
  // Restore asked for mine: when it cannot merge, mine stands whole.
  // Kept edits may have reached Barkpark (the unload beacon): may have landed.
  if (typeof base === 'string' && typeof mine === 'string' && typeof theirs === 'string') return merge3(base, mine, theirs, true) ?? mine
  // A list (a Portable Text body: a paste kept, someone's words in the block since) merges
  // item by item, their words kept; whole, a restore took them out unseen.
  if (Array.isArray(base) && Array.isArray(mine) && Array.isArray(theirs)) return mergeList3(base, mine, theirs) ?? mine
  return mine
}

/**
 * A kept block of a text field (`body[_key=="b"]`, saved by its key) put back over the field as
 * it is now: as the field, with the block merged into the run it is there (the block and the
 * pieces another editor's split made of it after it, and the new blocks between), task-2c01c385ce7b51d0. Put back whole
 * at its key, it took out their paste and put its own words in again where the split moved
 * them. The edit goes onto the server's version of the block where the text it touched still
 * stands there, and on into the new blocks right after it (keys new since the edit was made,
 * `p.keys`) only where they are a split of the block (lib/kept-stands.ts). Otherwise it cannot be
 * told, and the field comes back as the server has it. A block is never a target for the letters
 * it holds. Null: not such a block, or not there now (it goes as kept).
 */
export function restoreBlock(p: Pending, field: string, mine: unknown, doc: Doc): [string, unknown[]] | null {
  const m = /^(\w+)\[_key=="([^"]+)"\]$/.exec(field)
  if (!m) return null
  const [, root, key] = m as unknown as [string, string, string]
  const base = new Map(p.base).get(field)
  const list = getPath(doc, root)
  if (!Array.isArray(list) || !isText(base) || !isText(mine)) return null
  const at = list.findIndex((b) => keyOf(b) === key)
  if (at < 0 || !isText(list[at])) return null
  // The new text blocks right after it may be its split (a paragraph pasted at its start keeps the
  // key on its first piece: "x", "y", "zStart text"). A block that was there when the edit was
  // made ends them; with no keys kept (an older entry), the block alone.
  const old = new Map(p.keys ?? []).get(root)
  let last = at + 1
  while (old && last < list.length && isText(list[last]) && !old.includes(keyOf(list[last]) ?? '')) last++
  const reach = keptReach(textOf(base), textOf(mine), list.slice(at, last).map((b) => textOf(b as Parameters<typeof textOf>[0])))
  const merged = reach === null ? null : mergeList3([base], [mine], list.slice(at, at + reach + 1))
  return [root, merged ? [...list.slice(0, at), ...merged, ...list.slice(at + reach! + 1)] : list]
}
