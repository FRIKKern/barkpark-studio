import type {Block, BlockOp, Rev} from './blocks'

// D21, after Barkdown's retained drafts ("Put the words back", tabs/paper.js): when a
// canvas save fails, what the author wrote is kept on this computer at once, not at
// quit, so a closed tab or a crash loses nothing. On reopen the document offers it back.
// One entry per document (and field), per workspace scope and editor (another editor in
// this browser is never offered them, task-78bb96e068c0550a); a later failure overwrites it.

export type Kept = {at: number; rev: Rev; blocks: Block[]}

const KEY = 'bp-kept-words:'
export const keptKey = (scope: string, editor: string | null, type: string, id: string, field?: string) => `${KEY}${scope}|${editor ?? '-'}|${type}|${id}${field ? `|${field}` : ''}`

export function keep(key: string, kept: Kept) {
  try {
    localStorage.setItem(key, JSON.stringify(kept))
    return true
  } catch {
    return false // private mode or full: the card still says the edit is on screen only
  }
}

export function readKept(key: string): Kept | null {
  try {
    const kept = JSON.parse(localStorage.getItem(key) ?? 'null') as Kept | null
    return kept && Array.isArray(kept.blocks) ? kept : null
  } catch {
    return null
  }
}

/** Whether this browser keeps words for a doc's canvas (any scope or editor: the canvas checks its own). */
export function keptFor(type: string, id: string, field?: string) {
  const end = `|${type}|${id}${field ? `|${field}` : ''}`
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(KEY) && k.endsWith(end)) return true
    }
  } catch {}
  return false
}

/** When this browser last kept words for any canvas of a doc (null: none). */
export function keptAt(type: string, id: string) {
  let at: number | null = null
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k?.startsWith(KEY) || !(k.endsWith(`|${type}|${id}`) || k.includes(`|${type}|${id}|`))) continue
      const kept = readKept(k)
      if (kept && (at === null || kept.at > at)) at = kept.at
    }
  } catch {}
  return at
}

export function forget(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {}
}

const free = (b: Block) => typeof b.fieldName !== 'string' && b.role !== 'title'
const same = (a: Block, b: Block) => JSON.stringify(a) === JSON.stringify(b)

/**
 * The one write that puts the kept words back over the document as it is now (the
 * replaced text stays in its history): bound and title blocks are replaced in place,
 * the free blocks are swapped for the kept ones in their order, as Barkdown does.
 * Empty when the document already says what was kept.
 */
export function putBackOps(server: Block[], kept: Block[]): BlockOp[] {
  const byId = new Map(server.map((b) => [b.id, b]))
  const bound = kept.filter((b) => !free(b) && byId.has(b.id) && !same(byId.get(b.id)!, b)).map((b) => ({op: 'replace-block', id: b.id, block: b}))
  const keptFree = kept.filter(free)
  const serverFree = server.filter(free)
  if (keptFree.length === serverFree.length && keptFree.every((b, i) => same(b, serverFree[i]!))) return bound
  const stamp = Date.now().toString(36)
  return [
    ...bound,
    ...serverFree.map((b) => ({op: 'remove-block', id: b.id})),
    ...keptFree.map((b, i) => ({op: 'append-block', block: {...b, id: `kept-${stamp}-${i}`}})),
  ]
}

/**
 * D22: the ops that take a document back to `before` (Barkdown's restoreBlocks): an
 * append is undone by removing what was added; anything else as putBackOps.
 */
export function restoreOps(current: Block[], before: Block[]): BlockOp[] {
  if (before.length <= current.length && before.every((b, i) => same(b, current[i]!))) return current.slice(before.length).reverse().map((b) => ({op: 'remove-block', id: b.id}))
  return putBackOps(current, before)
}
