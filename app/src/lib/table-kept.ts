import {useSyncExternalStore} from 'react'
import {addKept, type TableKept} from './table-keep.ts'

// Text of mine a table's column change (or theirs in the same cell) left out of the table
// (lib/table-keep.ts), per document, for TableInput's card: Copy, Put it back, Dismiss. Kept on
// this computer too, as the canvas's kept words are (lib/kept-words.ts), so a reload or a closed
// tab offers it again; per workspace scope and editor (lib/edits.ts setKeepScope), never to another.

export type KeptText = TableKept & {id: string}

const KEY = 'bp-table-kept:'
const EMPTY: KeptText[] = []
let scope: string | null = null
const byDoc = new Map<string, KeptText[]>()
const listeners = new Set<() => void>()
const keyOf = (doc: string) => scope && `${KEY}${scope}|${doc}`

function read(doc: string): KeptText[] {
  let list = byDoc.get(doc)
  if (list) return list
  try {
    const key = keyOf(doc)
    const stored: unknown = key ? JSON.parse(localStorage.getItem(key) ?? '[]') : []
    list = Array.isArray(stored) ? stored.filter((k): k is KeptText => !!k && typeof k.text === 'string' && typeof k.row === 'string' && typeof k.id === 'string') : []
  } catch {
    list = [] // private mode, or blocked: kept on screen only
  }
  byDoc.set(doc, list)
  return list
}

function save(doc: string, list: KeptText[]) {
  byDoc.set(doc, list)
  try {
    const key = keyOf(doc)
    if (key) list.length ? localStorage.setItem(key, JSON.stringify(list)) : localStorage.removeItem(key)
  } catch {}
  listeners.forEach((l) => l())
}

/** Where kept text is stored (set with the edits' keep scope); another scope reads its own. */
export function setTableKeptScope(next: string | null) {
  if (next === scope) return
  scope = next
  byDoc.clear()
  listeners.forEach((l) => l())
}

/** After a rebase (lib/edits.ts): the text it kept moves here, one entry per cell (a later keep of the same cell grows it). */
export function takeTableKept(doc: string, e: {kept?: TableKept[]}) {
  if (!e.kept?.length) return
  const list = read(doc).map((k) => ({...k}))
  for (const k of e.kept.splice(0)) addKept(list, {...k, id: `${k.at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`})
  save(doc, list)
}

/** The input's text of a cell the other editor removed, typed in since it was focused (TableInput): kept. Its entry's id. */
export function keepTyped(doc: string, k: TableKept): string {
  const list = read(doc).map((x) => ({...x}))
  const id = addKept(list, {...k, id: `${k.at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`}).id
  save(doc, list)
  return id
}

/** Typing on in a kept text (its card input, or keys that reached the cell's input before it moved). */
export function setKeptText(doc: string, id: string, text: string) {
  save(doc, read(doc).map((k) => (k.id === id ? {...k, text} : k)))
}

export function dropKept(doc: string, id: string) {
  save(doc, read(doc).filter((k) => k.id !== id))
}

/** A document's kept table text (all its tables: the input picks its own). */
export function useTableKept(doc: string | undefined): KeptText[] {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => (doc ? read(doc) : EMPTY),
    () => EMPTY,
  )
}
