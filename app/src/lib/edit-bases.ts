import type {Doc} from './data'
import {merge3, mergeList3, mergeText} from './merge.ts'
import {mergeBlock} from './pt-merge.ts'
import {answeredInto, anyInside, applyPaths, getPath, mergePending, setInside, within} from './paths.ts'
import {SPAN_TEXT} from './pt-dmp.ts'
import {columnsOf, mergeTablePart, waitsWithTable} from './table-merge.ts'
import {keepCell, keepOnShapeChange, type TableKept} from './table-keep.ts'

// What lib/edits.ts keeps for a document's unsent edits, and how it changes with a server
// version (rebase), an edit (takeBase), a save sent (sentNotesOf) and its answer (answered) or
// failure (unsent). Pure, so the save queue's tests run it (table-sim.ts, edit-bases.test.ts).
//
// Every pending spot (a field, or a path into one) is measured from a base: the server's value
// there that this editor's edits are made on. A merge reads what changed on each side from it.
// A base holding this editor's own words, not yet saved, reads them as someone else's removal
// when the next version comes: the words go.

type Json = string | number | boolean | null | Json[] | {[k: string]: Json}

export type Spots = {
  dirty: Map<string, unknown>
  inflight: Map<string, unknown> | null
  /** For each field with edits in dirty or inflight: the server value they were made from. */
  base: Map<string, unknown>
  /** The server rev our unsent edits are made against (sent as ifRevisionID). */
  rev?: string
  /**
   * A server version that changed a field of ours while it was in flight. It is merged
   * when that write comes back refused or failed; until then `rev` stays where the write
   * was made, so a retry is refused (412) rather than saved over theirs.
   */
  missed?: Doc
  /** The document as the server had it before the first frame held in `missed` (a table's merge reads it). */
  missedFrom?: Record<string, unknown>
  /** Fields whose last write got no answer (a network failure): Barkpark may hold it already. */
  unsure?: Set<string>
  /**
   * What this editor's own writes to a spot did to its columns (a table's rows: lib/table-merge.ts
   * COLUMNS), in order since the spot's base; null where one did not say. Merged onto another
   * editor's rows, the column this editor pressed is known, not read from the cells.
   */
  notes?: Map<string, (unknown | null)[]>
  /** A table's text of mine its rebase did not merge (lib/table-keep.ts), for the editor to take. */
  kept?: TableKept[]
  /** How many of each spot's notes went with the write in flight. */
  sentNotes?: Map<string, number>
}

export const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

/**
 * Move our unsent edits onto server doc `d`: fields someone else changed meanwhile merge.
 * Returns the fields that could not: text of ours they rewrote. Ours stays (on screen and
 * pending), unsent, until the editor says so.
 */
export function rebase(e: Spots, d: Doc, was?: Doc | null): string[] {
  const clashed: string[] = []
  let missed = false
  // The document as the server had it before `d`: what this browser held (`was`), its own
  // pending edits taken out. A table's merge reads which column became which from it.
  const before = e.missedFrom ?? (was ? applyPaths(was as Record<string, unknown>, e.base) : undefined)
  // A table whose columns changed (or a row of it gone) under my unsent text: that text is kept, not merged.
  keepOnShapeChange(e, d, before)
  for (const [f, base] of e.base) {
    const theirs = getPath(d, f)
    if (same(theirs, base)) continue
    // Our own write coming back is not someone else's change.
    if (e.inflight?.has(f) && same(theirs, e.inflight.get(f))) {
      e.base.set(f, theirs)
      sentNotesLanded(e, f)
      continue
    }
    // A field with a write in flight merges when that write comes back (afterInflight, or
    // the save's answer): until then theirs may or may not hold it, and a merge from the
    // base before it either typed it twice or, in a run of one letter, dropped keys
    // (task-510e753bc62a59f0). A dirty-only one merges now. Advancing `rev` past theirs
    // here let a retry of that write save over theirs, unseen (task-41ba9f3dc3fd81e2).
    // So does a whole value with a write of this editor's on its way inside it (a span typed
    // in, then its block moved): merged now, the frame of that own write read as theirs.
    // A table's row waits with its table's other spots on their way (lib/table-merge.ts waitsWithTable).
    if (!e.dirty.has(f) || e.inflight?.has(f) || (e.inflight && (anyInside(e.inflight.keys(), f) || waitsWithTable(f, e.inflight.keys(), d)))) {
      missed = true
      continue
    }
    const mine = e.dirty.get(f)
    if (typeof base === 'string' && typeof mine === 'string' && typeof theirs === 'string') {
      // A Portable Text span's text (two editors typing in one block): never held, never a
      // word dropped (mergeText); other text fields hold a clash for the editor to settle.
      const merged = SPAN_TEXT.test(f) ? mergeText(base, mine, theirs, !!e.unsure?.has(f)) : merge3(base, mine, theirs, !!e.unsure?.has(f))
      e.unsure?.delete(f)
      if (merged === null) clashed.push(f)
      else e.dirty.set(f, merged)
    } else if (Array.isArray(base) && Array.isArray(mine) && Array.isArray(theirs)) {
      // A list: their reorder, add or remove stays while I edit an item (else ours wins).
      // A table field's rows and cells merge as a table (cells have no keys: lib/table-merge.ts).
      const merged = mergeTablePart(f, base, mine, theirs, before, d, e.notes?.get(f), (row, column, text) => keepCell(e, f, row, column, text)) ?? mergeList3(base, mine, theirs)
      if (merged) e.dirty.set(f, merged as Json)
      // Merged rows are measured from theirs from here on: where my columns are now, the merge says.
      const note = columnsOf(merged)
      if (note) (e.notes ??= new Map()).set(f, [note])
      else e.notes?.delete(f)
    } else {
      // A Portable Text block saved by its key (`body[_key=="b"]`): their words in it merge as text.
      // They added or removed blocks (a paste that split it, its text moved to a new block):
      // the field goes whole, merged as a list, or their split would read as their rewrite.
      const whole = wholeField(e, f, base, mine, before, d)
      if (whole) {
        e.dirty.delete(f), e.base.delete(f), e.notes?.delete(f)
        e.dirty.set(whole.field, whole.merged), e.base.set(whole.field, getPath(d, whole.field))
        continue
      }
      const merged = mergeBlock(base, mine, theirs)
      if (merged) e.dirty.set(f, merged)
    }
    e.base.set(f, theirs)
  }
  if (missed) (e.missed = d), (e.missedFrom ??= before)
  else (e.rev = d._rev), (e.missedFrom = undefined)
  return clashed
}

/**
 * A text block pending by its key (`field[_key=="k"]`, nothing else of the field pending) where
 * the server's version `d` has blocks the one before it (`before`) had not, or lacks some: the
 * field whole, merged as a list from `before` (lib/merge.ts mergeList3: the block as text,
 * their new blocks once). Null otherwise.
 */
function wholeField(e: Spots, f: string, base: unknown, mine: unknown, before: Record<string, unknown> | undefined, d: Doc): {field: string; merged: unknown[]} | null {
  const m = /^([^[.]+)\[_key=="([^"]+)"\]$/.exec(f)
  if (!m || !before || (mine as {_type?: unknown} | null)?._type !== 'block') return null
  const [, field, key] = m
  const was = getPath(before, field!)
  const now = getPath(d, field!)
  const keys = (l: unknown[]) => l.map((x) => (x && typeof x === 'object' ? (x as {_key?: unknown})._key : undefined)).join('\u0000')
  if (!Array.isArray(was) || !Array.isArray(now) || keys(was) === keys(now) || !was.some((x) => (x as {_key?: unknown})?._key === key)) return null
  if ([...e.dirty.keys(), ...(e.inflight?.keys() ?? [])].some((k) => k !== f && within(k, field!))) return null
  const at = (v: unknown) => was.map((x) => ((x as {_key?: unknown})?._key === key ? v : x))
  const merged = mergeList3(at(base), at(mine), now)
  return merged ? {field: field!, merged} : null
}

/**
 * A save that did not land waits again, with what was edited since: one write per spot
 * (lib/paths.ts mergePending), each with the base it is measured from.
 */
export function unsent(e: Spots) {
  const {pending, dropped} = mergePending(e.inflight!, e.dirty)
  for (const f of dropped) (e.base.delete(f), e.notes?.delete(f))
  e.dirty = pending
  e.sentNotes = undefined
}

/**
 * An edit of `field` to `value`, made on `held` (this browser's copy): what it is measured
 * from, unless a pending spot holding it has that already. A whole value over spots pending
 * inside it (a Portable Text body after its blocks went by key) takes their place: without its
 * own base its rebase had nothing to go by, kept the old rev, and the field's fence refused it
 * again and again (412). Made from what the server had there, not from this browser's own words
 * still on their way inside it: each spot pending inside (a span typed in, then its table's rows
 * set whole) is put back to its own base. Left in, the whole value read as unchanged by this
 * editor where it held them, and the answer to the earlier save took them out again.
 */
export function takeBase(e: Spots, field: string, held: unknown, value: unknown) {
  const fresh = ![...e.base.keys()].some((k) => within(field, k))
  if (fresh) {
    let from = getPath(held, field)
    for (const [k, was] of e.base) if (k !== field && within(k, field)) from = setInside(field, from, k, was)
    e.base.set(field, from)
    for (const k of [...e.base.keys()]) if (k !== field && within(k, field) && !e.inflight?.has(k)) (e.base.delete(k), e.notes?.delete(k))
  }
  // The spot's own column notes: what this write did to the columns of the rows it was made on.
  if (!e.base.has(field)) return
  const note = columnsOf(value) ?? null
  const notes = (e.notes ??= new Map())
  if (fresh) note ? notes.set(field, [note]) : notes.delete(field)
  else if (note || notes.has(field)) notes.set(field, [...(notes.get(field) ?? [null]), note])
}

/** A save goes: how many of each spot's notes it carries (an answer measures from what it saved). */
export function sentNotesOf(e: Spots) {
  e.sentNotes = new Map([...(e.notes ?? [])].filter(([f]) => e.inflight?.has(f)).map(([f, n]) => [f, n.length]))
}

/** A spot's write landed (its answer, or its own frame back): its base is what it saved, and its notes are the ones made since. */
function sentNotesLanded(e: Spots, f: string) {
  const n = e.notes?.get(f)
  // Notes the save did not count (none when it went) stay: an unknown among them says so.
  if (n && e.dirty.has(f)) e.notes!.set(f, n.slice(e.sentNotes?.get(f) ?? 0))
  else e.notes?.delete(f)
  e.sentNotes?.delete(f)
}

/**
 * A save was answered with `saved`: what was sent is the server's now, and a spot still being
 * typed builds on it. That holds for a spot typed inside one that was on its way too (a cell
 * typed into a column just inserted, its rows then in flight): until now the rows' base held it,
 * and from here on the answer is its base. Left without one, its next key took its base from
 * this browser's copy, its own unsent letters in it, and the next version (anyone's frame)
 * read them as removed: they went.
 */
export function answered(e: Spots, saved: unknown) {
  for (const f of e.inflight!.keys()) {
    if (e.dirty.has(f)) e.base.set(f, getPath(saved, f))
    else e.base.delete(f)
    answeredInto(e.base, f, getPath(saved, f))
    for (const k of e.dirty.keys()) if (k !== f && within(k, f) && ![...e.base.keys()].some((b) => within(k, b))) e.base.set(k, getPath(saved, k))
    sentNotesLanded(e, f)
    e.unsure?.delete(f)
  }
  e.sentNotes = undefined
}
