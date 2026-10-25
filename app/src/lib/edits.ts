import {useSyncExternalStore} from 'react'
import type {QueryClient} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset, requestToken, underPressure} from '../server/barkpark'
import {writeFaultFor} from '../server/write-faults'
import {currentEditor, signOut} from '../server/auth'
import {expectEcho, mutatedIds} from '../server/listen'
import {docQuery, readServerDoc, schemasQuery, setUnsavedOverlay, type Doc, type Field, type ListPage, type Schema} from './data'
import {advisoryFindings, findingsOf, findingsReason, type Finding} from './findings'
import {t} from './i18n'
import {setFooterOffline} from './footer-offline'
import {heldFor} from './held-for'
import {slugsTakenNow} from './slug-unique'
import {plainReason} from './plain-reason'
import {merge3, mergeList3, onto, revertSteps} from './merge'
import {applyPaths, getPath, setPath, within} from './paths'
import {combine, dropPending, judge, ownedElsewhere, pendingKey, putPending, readDocPending, restoreValue, TAB, type Pending} from './pending-edits'
import {WRITE_BURST, WRITE_GAP_MS, writeBudget} from './write-budget'
import {paceMs, paced} from './write-pace'

// Local-first editing. A keystroke writes the query cache at once (input, pane
// title, list row all repaint with no network wait); the write goes to Barkpark
// behind it. Writes are coalesced per document: one in flight, at least
// MIN_GAP_MS apart, later values for a field replacing earlier ones. Over all
// documents they spend a write budget (WRITE_BURST at once, then one per
// WRITE_GAP_MS), so a short edit goes out at once and long typing settles at the
// old pace, under Barkpark's per-token limit. Leaving a field, closing a pane or
// the page flushes. Server truth (mutate responses, live frames) is folded
// back in under whatever is still unsent, and never older than what we hold.
//
// Concurrent edits (J05, J06): every patch carries the rev it was made against
// (ifRevisionID). Someone else wrote first → 412 → read theirs, rebase ours on it
// (text fields merge with diff-match-patch, lists item by item, other values: ours wins), send again.
// A live frame that changes a field being typed in rebases it the same way at once.

type Json = string | number | boolean | null | Json[] | {[k: string]: Json}

const throwLost = (): never => {
  throw new Error(`mutate 401: ${JSON.stringify({error: {code: 'session_lost', message: "You've been logged out"}})}`)
}

export const mutate = createServerFn({method: 'POST'})
  .validator((d: {mutations: Json[]}) => d)
  .handler(async ({data}) => {
    // e2e only: a fault set for a document this write names (server/write-faults.ts).
    const fault = writeFaultFor(data.mutations)
    if (fault?.kind === '500') throw new Error('mutate 500: {"error":{"code":"internal_error","message":"Internal Server Error"}}')
    if (fault?.kind === '412') throw new Error('mutate 412: {"error":{"code":"precondition_failed","message":"document revision mismatch"}}')
    if (fault?.kind === '413') throw new Error('mutate 413: {"error":{"code":"payload_too_large","message":"The request body is larger than the limit"}}')
    if (fault?.kind === 'hang') await new Promise((go) => setTimeout(go, fault.ms ?? 0))
    const res = await bpFetch(`/v1/data/mutate/${dataset()}`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({mutations: data.mutations}),
    })
    const body = (await res.json().catch(() => ({}))) as Json
    // The token's write budget is running out (lib/write-pace.ts): this browser writes less often.
    if (res.ok && underPressure()) (body as {[k: string]: Json}).studioThrottled = true
    if (!res.ok) {
      // The long `hint` is dropped so a publish wall's `details` (rule + fix) survive the cut.
      // A validation refusal keeps its coded findings whole (barkpark#22375), not the English map.
      const {error} = body as {error?: {[k: string]: Json}}
      // A dead token (revoked or expired: 401 since Barkpark #22517). The signed-in editor's
      // own: their session ends, they sign in again and get a new one (J48). The studio's
      // own: nobody here can fix that, so say so (#312) instead of "logged out".
      if (res.status === 401) {
        // No editor any more (bpFetch refused to write as the studio): logged out, not refused.
        if (error?.code === 'session_lost') throwLost()
        if (currentEditor()) (void signOut(), throwLost())
        throw new Error(`mutate 401: ${JSON.stringify({error: {code: 'token_refused', message: "Barkpark refused this studio's token."}})}`)
      }
      const {hint: _, ...short} = error ?? {}
      if (Array.isArray(short.findings)) throw new Error(`mutate ${res.status}: ${JSON.stringify({error: {code: short.code, message: short.message, findings: short.findings}}).slice(0, 8000)}`)
      throw new Error(`mutate ${res.status}: ${JSON.stringify(error ? {error: short} : body).slice(0, 600)}`)
    }
    // e2e 'reset': the write landed, its answer is lost on the way back (a network error here).
    if (fault?.kind === 'reset') throw new Error('fetch failed (e2e: the answer was lost)')
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
type Snap = {state: SaveState; error?: string; creating?: boolean; retry?: boolean}
type DocEdits = {
  type: string
  /** What Barkpark's schema check said of the last save (advisory: never blocks, #22406). */
  advisories?: Finding[]
  dirty: Map<string, unknown>
  inflight: Map<string, unknown> | null
  snap: Snap
  lastSent: number
  timer?: ReturnType<typeof setTimeout>
  /** A new doc that exists only here: its first write creates it with these values. */
  pendingCreate?: Record<string, unknown>
  /** Create even without fields; untouched lazy drafts still cost no write. */
  createRequested?: boolean
  /** The server rev our unsent edits are made against (sent as ifRevisionID). */
  rev?: string
  /** J16: these edits make the draft of a published document (see send). */
  forks?: boolean
  /** For each field with edits in dirty or inflight: the server value they were made from. */
  base: Map<string, unknown>
  /** Rebases in a row (a guard against a write that never gets through). */
  conflicts: number
  /** Text of ours someone rewrote meanwhile (clash): held, unsent, until the editor types on. */
  held?: boolean
  /** The clashed fields: what the other writer left there, and the version it came with. */
  clashes?: Map<string, FieldClash>
  /**
   * A server version that changed a field of ours while it was in flight. It is merged
   * when that write comes back refused or failed; until then `rev` stays where the write
   * was made, so a retry is refused (412) rather than saved over theirs.
   */
  missed?: Doc
  /** Fields whose last write got no answer (a network failure): Barkpark may hold it already. */
  unsure?: Set<string>
  /** The last value this editor gave each field: a cache still holding it has nothing new of anyone else's. */
  typed: Map<string, unknown>
  /** This editor's own changes, for Mod+Z / Mod+Shift+Z (F7). */
  undo: Change[]
  redo: Change[]
  /** Writes this doc's unacknowledged edits to IndexedDB a moment after the last change. */
  keepTimer?: ReturnType<typeof setTimeout>
}

/**
 * One of this editor's own changes: typing in one field within UNDO_GROUP_MS is one
 * change (timed by the keys, never by the writes), kept as its keystrokes (each from the value as it stood then, so someone
 * else's text merged in between is never part of a step).
 */
type Change = {field: string; steps: {before: unknown; after: unknown}[]; at: number; body?: true}
const UNDO_GROUP_MS = 600

/**
 * A body field's canvas, for the document's undo (Sanity's walks from the form into its
 * Portable Text): one step of the canvas's own history (Barkpark canvas 1.10.0), and where
 * the caret goes. The canvas keeps its steps; the document's undo holds a marker per step
 * (`body`), moved as the canvas reports its history (bodyHistory), so a Mod+Z inside the
 * canvas and one from the form never take the same step twice.
 */
type BodyHistory = {undo: () => boolean; redo: () => boolean; focus: () => void}
const bodies = new Map<string, Map<string, BodyHistory>>()
export function registerBody(id: string, field: string, history: BodyHistory) {
  const byField = bodies.get(id) ?? new Map<string, BodyHistory>()
  bodies.set(id, byField)
  byField.set(field, history)
  return () => void (byField.get(field) === history && byField.delete(field))
}

/**
 * The canvas's history moved (its `bp-canvas-history`): a new step (which, as a field
 * edit, ends what could be redone), an undo or redo of one, or the history gone (a remount).
 */
export function bodyHistory(id: string, type: string, field: string, kind: 'step' | 'undo' | 'redo' | 'clear', count = 1) {
  const e = entry(id, type)
  const mine = (c: Change) => !!c.body && c.field === field
  const move = (from: Change[], to: Change[]) => {
    for (let n = 0; n < count; n++) {
      let at = from.length - 1
      while (at >= 0 && !mine(from[at]!)) at--
      if (at < 0) return
      to.push(...from.splice(at, 1))
    }
  }
  if (kind === 'step') {
    for (let n = 0; n < count; n++) e.undo.push({field, steps: [], at: 0, body: true})
    e.redo = []
  } else if (kind === 'undo') move(e.undo, e.redo)
  else if (kind === 'redo') move(e.redo, e.undo)
  else (e.undo = e.undo.filter((c) => !mine(c))), (e.redo = e.redo.filter((c) => !mine(c)))
}

// A patch is fenced on the fields it sets, not the whole document (Barkpark's opt-in, task-
// 61e9a7d8a8b51192): another editor's write to another field, the body or a list no longer
// sends it back as stale (412: read, rebase, resend; 133 of them in a five-editor room). A
// change to one of its own fields still answers 412, so a clash is still seen. A Barkpark
// without the opt-in ignores the key. Not on a draft's first edit: its empty marker patch
// carries the fence there, and an empty patch touches no field.
const FIELDS_FENCE = {fence: 'fields'} as const
const MIN_GAP_MS = 100
const budget = writeBudget(WRITE_BURST, WRITE_GAP_MS)
const STALL_MS = 4000
export const OFFLINE_RETRY_MS = 5000

const online = () => typeof navigator === 'undefined' || navigator.onLine
export const isNetworkError = (err: unknown) => !online() || err instanceof TypeError || /failed to fetch|networkerror|load failed|fetch failed/i.test(String((err as Error)?.message))
// Docs waiting for the network to come back: each sends again on the 'online' event.
const waiting = new Map<string, () => void>()
if (typeof window !== 'undefined') {
  addEventListener('online', () => {
    const go = [...waiting.values()]
    waiting.clear()
    go.forEach((f) => f())
  })
  // B11: closing the tab (or reloading, or leaving the studio) with anything not yet
  // saved asks first, as Sanity does: edits still batching or on their way, a save
  // that failed or was refused, a lost session, an unconfirmed create, a Freeform
  // canvas with a pending or refused batch. If the editor leaves anyway, pagehide
  // still sends what it can (flushOnUnload).
  addEventListener('beforeunload', (ev) => {
    if (!hasUnsaved()) return
    ev.preventDefault()
    ev.returnValue = ''
  })
}

/** B11: unsaved state held outside the field edits below (a Freeform canvas registers here). */
export const unsavedElsewhere = new Set<() => boolean>()
const UNSAVED_STATES: SaveState[] = ['stalled', 'offline', 'recovering', 'error', 'signedOut', 'refused']
/** Whether anything typed here has not reached Barkpark yet (or was refused). */
export function hasUnsaved() {
  for (const d of docs.values()) if (d.dirty.size || d.inflight || d.createRequested || UNSAVED_STATES.includes(d.snap.state)) return true
  for (const check of unsavedElsewhere) if (check()) return true
  return false
}
// e2e probe: a spec's cleanup waits for this page's saves on their way (not a refused or
// offline state, which no wait ends) before it resets the data.
if (typeof window !== 'undefined')
  (window as {__savesPending?: () => boolean}).__savesPending = () =>
    [...docs.values()].some((d) => d.dirty.size || d.inflight || d.createRequested) ||
    [...document.querySelectorAll('bp-paper-canvas')].some((c) => !!(c as {hasPendingChanges?: () => boolean}).hasPendingChanges?.())

/**
 * B11 widen (lib/pending-edits.ts): where unacknowledged edits are kept: workspace,
 * project, dataset and editor, set by the studio once it knows them. Unset: nothing is kept.
 */
let keepScope: string | null = null
export function setKeepScope(scope: string | null) {
  keepScope = scope
}
/** Where edits to `id` are kept for any page; this page's own entry is `keepKeyOf`. */
const docKeyOf = (id: string) => keepScope && `${keepScope}|${id}`
export const keepKeyOf = (id: string) => keepScope && pendingKey(`${keepScope}|${id}`)
/** The entries for `id` left by pages that are gone (one still open keeps its own). */
async function orphaned(id: string): Promise<{keys: string[]; pending: Pending} | null> {
  const key = docKeyOf(id)
  if (!key) return null
  const mine = pendingKey(key)
  const all = await readDocPending(key)
  const dead: [string, Pending][] = []
  for (const [k, p] of all) if (k !== mine && !(await ownedElsewhere(p))) dead.push([k, p])
  const pending = combine(dead.map(([, p]) => p))
  return pending && {keys: dead.map(([k]) => k), pending}
}
const KEEP_GAP_MS = 150

/** Keep what Barkpark has not acknowledged for `id` in this browser, or forget it once there is nothing. */
function keepUnsaved(id: string, e: DocEdits) {
  const key = keepKeyOf(id)
  if (!key) return
  clearTimeout(e.keepTimer)
  // A doc that exists only here has no server version to replay onto: not kept.
  if (e.pendingCreate || (!e.dirty.size && !e.inflight)) return void dropPending(key)
  e.keepTimer = setTimeout(() => {
    const fields = [...(e.inflight ?? []), ...e.dirty]
    if (fields.length) void putPending(key, {at: Date.now(), type: e.type, rev: e.rev, fields, base: [...e.base], tab: TAB})
  }, KEEP_GAP_MS)
}

const SAVED: Snap = {state: 'saved'}
const docs = new Map<string, DocEdits>()
const listeners = new Set<() => void>()
const setState = (e: DocEdits, state: SaveState, error?: string, retry = false) => {
  const creating = !!e.pendingCreate && !!e.createRequested
  // The same state again tells nobody: the footer and the pane re-drew on each repeat.
  if (e.snap.state === state && e.snap.error === error && e.snap.creating === creating && !!e.snap.retry === retry) return
  e.snap = {state, error, creating, ...(retry && {retry})}
  setFooterOffline(anyOffline())
  listeners.forEach((l) => l())
}
const anyOffline = () => [...docs.values()].some((d) => d.snap.state === 'offline') || [...canvasOffline.values()].some((k) => k.size > 0)

const entry = (id: string, type: string) => {
  let e = docs.get(id)
  if (!e) docs.set(id, (e = {type, dirty: new Map(), inflight: null, snap: SAVED, lastSent: 0, base: new Map(), conflicts: 0, typed: new Map(), undo: [], redo: []}))
  return e
}

/** `doc` with the values typed here that the server has not confirmed yet on top (keys may be paths). */
function overlay(id: string, doc: Doc): Doc {
  const e = docs.get(id)
  return e ? applyPaths(applyPaths(doc, e.inflight ?? []), e.dirty) : doc
}
// Every read of a doc keeps the values still on their way (see data.ts withUnsaved).
setUnsavedOverlay((doc) => overlay(doc._publishedId, doc))

function writeCache(qc: QueryClient, id: string, type: string, doc: Doc) {
  // J56: when the published version last changed; a draft keeps what the row knew.
  const keep = (was: Doc | null | undefined): Doc => ({...doc, _publishedAt: doc._publishedAt ?? (doc._draft ? was?._publishedAt : doc._updatedAt)})
  qc.setQueryData<Doc | null>(['doc', id], (was) => keep(was))
  qc.setQueriesData<ListPage>({queryKey: ['list', type]}, (page) => page && {...page, docs: [keep(page.docs.find((d) => d._publishedId === id)), ...page.docs.filter((d) => d._publishedId !== id)]})
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

/**
 * Move our unsent edits onto server doc `d`: fields someone else changed meanwhile merge.
 * Returns the fields that could not: text of ours they rewrote. Ours stays (on screen and
 * pending), unsent, until the editor says so.
 */
function rebase(e: DocEdits, d: Doc): string[] {
  const clashed: string[] = []
  let missed = false
  for (const [f, base] of e.base) {
    const theirs = getPath(d, f)
    if (same(theirs, base)) continue
    // Our own write coming back is not someone else's change.
    if (e.inflight?.has(f) && same(theirs, e.inflight.get(f))) {
      e.base.set(f, theirs)
      continue
    }
    // A field with a write in flight merges when that write comes back (afterInflight, or
    // the save's answer): until then theirs may or may not hold it, and a merge from the
    // base before it either typed it twice or, in a run of one letter, dropped keys
    // (task-510e753bc62a59f0). A dirty-only one merges now. Advancing `rev` past theirs
    // here let a retry of that write save over theirs, unseen (task-41ba9f3dc3fd81e2).
    if (!e.dirty.has(f) || e.inflight?.has(f)) {
      missed = true
      continue
    }
    const mine = e.dirty.get(f)
    if (typeof base === 'string' && typeof mine === 'string' && typeof theirs === 'string') {
      const merged = merge3(base, mine, theirs, !!e.unsure?.has(f))
      e.unsure?.delete(f)
      if (merged === null) clashed.push(f)
      else e.dirty.set(f, merged)
    } else if (Array.isArray(base) && Array.isArray(mine) && Array.isArray(theirs)) {
      // A list: their reorder, add or remove stays while I edit an item (else ours wins).
      const merged = mergeList3(base, mine, theirs)
      if (merged) e.dirty.set(f, merged as Json)
    }
    e.base.set(f, theirs)
  }
  if (missed) e.missed = d
  else e.rev = d._rev
  return clashed
}

/**
 * A write came back without saving (refused, failed): its values wait in `dirty` again,
 * merged with any server version that changed them meanwhile. A clash is said at once.
 * True when it clashed (the edits are held, nothing to retry).
 */
function afterInflight(qc: QueryClient, id: string, e: DocEdits): boolean {
  e.dirty = new Map([...e.inflight!, ...e.dirty])
  e.inflight = null
  const d = e.missed
  e.missed = undefined
  const clashed = d ? rebase(e, d) : []
  if (d && clashed.length) clash(qc, id, e, clashed, d)
  // Merged: the field shows it too, or the next keystroke sends the field as it was on
  // screen, over theirs, on the rev that now says it saw them.
  else if (d) writeCache(qc, id, e.type, overlay(id, d))
  return clashed.length > 0
}

/**
 * Someone rewrote text the editor had changed: theirs and ours cannot both stand. Ours
 * stays on screen, not sent: said in the footer (refused), until the editor types on (then
 * it goes, over theirs, their choice) or discards.
 */
export type FieldClash = {theirs: unknown; rev: string; at: string}
function clash(qc: QueryClient, id: string, e: DocEdits, fields: string[], doc: Doc) {
  e.held = true
  e.clashes = new Map(e.clashes)
  for (const f of fields) e.clashes.set(f, {theirs: getPath(doc, f), rev: doc._rev, at: doc._updatedAt})
  clearTimeout(e.timer)
  e.timer = undefined
  const all = qc.getQueryData(schemasQuery.queryKey)?.find((x) => x.name === e.type)?.fields ?? []
  const names = fields.map((f) => fieldTitle(all, f) ?? f).join(', ')
  setState(e, 'refused', t('Someone else rewrote {fields} meanwhile. Your text is kept here, not saved: type on to save yours over theirs.', {fields: names}))
}

// J16: an open History / Review changes panel follows the doc as Sanity's does: its
// revisions are read again a moment after any write lands (only while a panel shows them).
const historyTimers = new Map<string, ReturnType<typeof setTimeout>>()
export function historyChanged(qc: QueryClient, id: string) {
  clearTimeout(historyTimers.get(id))
  historyTimers.set(id, setTimeout(() => (historyTimers.delete(id), void qc.invalidateQueries({queryKey: ['history', id]})), 600))
}

/** Fold server truth into the cache: skip it when older than what we hold, keep unsent edits on top. */
export function applyServer(qc: QueryClient, doc: Doc) {
  const id = doc._publishedId
  const held = qc.getQueryData<Doc | null>(['doc', id])
  if (held && held._updatedAt > doc._updatedAt) return
  const e = docs.get(id)
  const clashed = e ? rebase(e, doc) : []
  // A published row (or a publish) proves a published version; a draft keeps what we knew.
  const _hasPublished = !doc._draft || (doc._hasPublished ?? held?._hasPublished ?? false)
  historyChanged(qc, id)
  writeCache(qc, id, doc._type, overlay(id, {...doc, _hasPublished} as Doc))
  if (e && clashed.length) clash(qc, id, e, clashed, doc)
}

/** `field` is a field name or a dotted path into an object ("seo.metaTitle"): only that path is sent. */
export function edit(qc: QueryClient, doc: Doc, field: string, value: unknown, record = true) {
  // Scout 7: clearing the last field of an object (or of a geopoint, its _type alone left)
  // unsets the object, as Sanity does: the empty shell ({} or {_type}) read as set to every
  // defined()/coalesce() and showed in diffs. Not inside an array item (the item stays).
  // An emptied text input clears with '' (sent as an unset, toPatch).
  const blank = (v: unknown) => v === undefined || v === null || v === ''
  if (blank(value) && field.includes('.') && !field.includes('[')) {
    const parent = field.slice(0, field.lastIndexOf('.'))
    const own = field.slice(parent.length + 1)
    const now = getPath(qc.getQueryData<Doc>(['doc', doc._publishedId]) ?? doc, parent)
    if (now && typeof now === 'object' && !Array.isArray(now) && Object.entries(now).every(([k, v]) => k === '_type' || k === own || blank(v))) return edit(qc, doc, parent, undefined, record)
  }
  const id = doc._publishedId
  const e = entry(id, doc._type)
  const held = qc.getQueryData<Doc>(['doc', id]) ?? doc
  // `value` was made from `doc`, what the pane last drew. Someone else's version that came
  // in since and is not drawn yet is in `held`: the change goes onto it, or it would go out
  // against held's rev and undo theirs unseen (live-list race, task-8cc2a447b03bf599). A
  // field still holding what this editor last gave it changed by our own hand only: a key
  // not drawn yet is in `value` already, and merging it again would type it twice.
  const now = getPath(held, field)
  if (held !== doc && held._rev !== doc._rev && !same(now, e.typed.get(field))) value = onto(getPath(doc, field), value, now)
  e.typed.set(field, value)
  if (record) {
    const step = {before: getPath(held, field), after: value}
    const last = e.undo.at(-1)
    if (last?.field === field && Date.now() - last.at < UNDO_GROUP_MS) (last.steps.push(step), (last.at = Date.now()))
    else e.undo.push({field, steps: [step], at: Date.now()})
    e.redo = []
  }
  // What this edit is made against: the server's value (and rev) as this browser has it.
  if (!e.dirty.size && !e.inflight) (e.rev = held._rev || undefined), (e.forks = held._draft === false && !e.pendingCreate)
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
  if (e.held) (e.held = false), (e.clashes = undefined) // typing on after a clash: theirs is overruled, by the editor
  keepUnsaved(id, e)
  // An edit makes (or updates) the draft: show it as one now.
  writeCache(qc, id, doc._type, setPath({...held, _draft: true} as Doc, field, value))
  if (e.snap.state === 'saved') setState(e, 'saving')
  // Signed out: hold it with the rest until the editor signs in again.
  if (e.snap.state === 'signedOut') return
  schedule(qc, id)
}

/** Send now if the budget has a write and the last one was MIN_GAP_MS ago, else once both hold. */
function schedule(qc: QueryClient, id: string) {
  const e = docs.get(id)
  if (!e || e.timer || (e.dirty.size === 0 && !e.createRequested)) return
  const wait = Math.max(e.lastSent + Math.max(MIN_GAP_MS, paceMs()) - Date.now(), budget.wait())
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
  const list = back ? e?.undo : e?.redo
  // A body step: the canvas takes it (its history report moves the marker) and the caret
  // goes into it; one whose canvas is gone, or has nothing left, is passed over.
  const top = list?.at(-1)
  if (top?.body) {
    const body = bodies.get(id)?.get(top.field)
    if (body && (back ? body.undo() : body.redo())) return void body.focus()
    if (list!.at(-1) === top) list!.pop()
    return undo(qc, id, back)
  }
  const change = list?.pop()
  if (!e || !doc || !change) return
  const steps = back ? [...change.steps].reverse().map((x) => [x.after, x.before] as const) : change.steps.map((x) => [x.before, x.after] as const)
  const was = getPath(doc, change.field)
  const now = revertSteps(steps, was)
  // Someone else changed it since and none of it is still ours: theirs stays, and the step is gone.
  if (same(now, was)) return
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

/** J53: before a reload to update, send everything waiting and wait for it (at most `ms`). */
export async function saveAll(qc: QueryClient, ms = 5000) {
  for (const id of docs.keys()) flush(qc, id)
  await Promise.race([Promise.all([...docs.keys()].map(whenSaved)), new Promise((r) => setTimeout(r, ms))])
}

/** Page is going away: hand every unsent change to the browser to deliver. */
export function flushOnUnload() {
  const mutations = [...docs].flatMap(([id, e]) => {
    if (e.snap.state === 'signedOut' || e.snap.state === 'refused') return []
    // A save on its way goes again too: the page's own request dies with it (the studio's
    // server stops forwarding it), so the last word typed before closing was lost when
    // nothing followed it (3 of 24 closes in the unsaved-changes sweep). Sent twice, it
    // sets the same value, and the latest wins in either order: the beacon is unfenced and
    // newest; the save on its way is fenced on its rev, so landing second it is refused (412).
    // A create on its way is left to its own request.
    const going = e.pendingCreate ? [] : [...(e.inflight ?? [])].filter(([f]) => ![...e.dirty.keys()].some((k) => within(f, k) || within(k, f)))
    const fields = new Map([...going, ...e.dirty])
    if (fields.size === 0 && (!e.createRequested || e.inflight)) return []
    const {set, unset} = toPatch(fields)
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

/** A finding's path ("seo/metaDescription", "seo.metaDescription") as its field titles, "SEO › Meta description". */
function fieldTitle(fields: Field[], path: string): string | undefined {
  const titles: string[] = []
  let here: Field[] | undefined = fields
  for (const name of path.split(/[./]/).filter((p) => p && !/^\d+$|^\[/.test(p))) {
    const f: Field | undefined = here?.find((x) => x.name === name)
    if (!f) break
    titles.push(f.title ?? f.name)
    here = f.fields ?? f.of?.fields
  }
  return titles.length ? titles.join(' › ') : undefined
}

/** Barkpark's own reason, from a thrown "mutate 403: {error: {message}}" (cut at 600 characters). */
export function reasonOf(msg: string): string | undefined {
  try {
    const body = JSON.parse(msg.slice(msg.indexOf('{'))) as {error?: {code?: string; message?: string; details?: {rule?: unknown; fix?: unknown; kind?: string; max?: number}}}
    // Too many of one kind in one request (Barkpark #22499): the studio splits deletes, but say it plainly if it ever shows.
    if (body.error?.code === 'batch_too_large') {
      const {kind, max} = body.error.details ?? {}
      return kind === 'delete' ? t('Too many deletions at once (at most {limit}). Try fewer.', {limit: max ?? 500}) : t('Too many changes at once. Try fewer.')
    }
    // A fault on Barkpark's side (a 500, a lost race, a busy database) in plain words.
    const plain = plainReason(body.error?.code, t)
    if (plain) return plain
    // A publish wall says which rule broke and how to fix it (D12).
    const {rule, fix} = body.error?.details ?? {}
    return body.error?.message && [body.error.message, rule, fix].filter((s): s is string => typeof s === 'string').map((s) => (/[.!?]$/.test(s) ? s : `${s}.`)).join(' ')
  } catch {
    const cut = /"message":"((?:[^"\\]|\\.)*)"/.exec(msg)?.[1]
    return cut && (JSON.parse(`"${cut}"`) as string)
  }
}

/** Retry, by hand, a save refused with a Retry offered (too large, 413). */
export function retrySave(qc: QueryClient, id: string) {
  const e = docs.get(id)
  if (e?.snap.retry && (e.dirty.size || e.createRequested)) (setState(e, 'saving'), void send(qc, id))
}

/** After signing in again: send every doc's edits that waited for it. */
export function resumeSaving(qc: QueryClient) {
  for (const [id, e] of docs) if (e.snap.state === 'signedOut' && (e.dirty.size || e.createRequested)) (setState(e, 'saving'), void send(qc, id))
}

/** J48 / task-03ca6c0c9a79adf1: told each sign-in's email; false when the held edits were someone else's and are dropped. */
const owns = heldFor()
export function editorIs(email: string | null): boolean {
  const theirs = owns(email)
  if (!theirs) forgetEdits()
  return theirs
}

/** Sign out: every edit held in this page is dropped, from memory and from this browser. */
export function forgetEdits() {
  for (const [id, e] of docs) {
    clearTimeout(e.timer)
    clearTimeout(e.keepTimer)
    const key = keepKeyOf(id)
    if (key) void dropPending(key)
  }
  docs.clear()
  waiting.clear()
  canvasSnaps.clear()
  canvasProblems.clear()
  canvasOffline.clear()
  setFooterOffline(false)
  listeners.forEach((l) => l())
}

/** Offline: hold everything, send again when the network is back (or try every few seconds). */
function waitForNetwork(qc: QueryClient, id: string, e: DocEdits) {
  // Offline only when the browser is: a write whose answer was lost on a live connection (a
  // reset mid-request) said "Offline — not saving" with the network up (save fault sweep).
  // That one is "Not saved — retrying".
  const up = online()
  setState(e, up ? 'error' : 'offline')
  waiting.set(id, () => void send(qc, id))
  // On a live connection, again as soon as any failed write is (2 s), not after the offline wait.
  setTimeout(() => waiting.has(id) && online() && (waiting.delete(id), void send(qc, id)), up ? 2000 : OFFLINE_RETRY_MS)
}

async function send(qc: QueryClient, id: string) {
  const e = docs.get(id)
  if (!e || e.inflight || (e.dirty.size === 0 && !e.createRequested)) return
  // Signed out: nothing goes until the editor is back (resumeSaving) — not even a flush on blur.
  if (e.snap.state === 'signedOut') return
  // A clash waits for the editor (no retry, no blur flush sends it over theirs).
  if (e.held) return
  if (e.pendingCreate) e.createRequested = true
  if (!online()) return waitForNetwork(qc, id, e)
  e.inflight = e.dirty
  e.dirty = new Map()
  e.lastSent = Date.now()
  budget.spend()
  const after = e.snap.state === 'offline' || e.snap.state === 'recovering'
  // "Not saved — retrying" stays until a save lands: flipped to Saving and back on every
  // key, each flip re-drew the footer and Publish (about 5x the style work on a long doc).
  if (e.snap.state !== 'error') setState(e, after ? 'recovering' : 'saving')
  const stall = setTimeout(() => e.inflight && setState(e, 'stalled'), STALL_MS)
  const {set, unset} = toPatch(e.inflight)
  const creating = e.pendingCreate
  try {
    const fence: Record<string, Json> = e.rev ? {ifRevisionID: e.rev} : {}
    // J16: the first edit of a published document makes its draft. Sent as an empty patch
    // and then the edit, Barkpark's history says "Draft created" and then "Edited", as
    // Sanity's timeline does (one patch was only "Draft created").
    const mutations: Json[] = creating
      ? [{create: {_id: id, _type: e.type, ...applyPaths(creating as Record<string, Json>, e.inflight)}}]
      : e.forks
        ? [{patch: {id, type: e.type, set: {}, ...fence}}, {patch: {id, type: e.type, set, unset}}]
        : [{patch: {id, type: e.type, set, unset, ...fence, ...(e.rev ? FIELDS_FENCE : {})}}]
    const r = (await mutate({data: {mutations}})) as {results: {document: Doc}[]; warnings?: unknown; studioThrottled?: boolean}
    paced(!!r.studioThrottled)
    const saved = r.results.at(-1)!.document
    e.forks = false
    e.advisories = advisoryFindings(r)
    if (creating) { e.pendingCreate = undefined; e.createRequested = false }
    // What we sent is now the server's: a field still being typed builds on it.
    for (const f of e.inflight.keys()) {
      if (e.dirty.has(f)) e.base.set(f, getPath(saved, f))
      else e.base.delete(f)
      e.unsure?.delete(f)
    }
    e.inflight = null
    // The save went through: what it answered is newer than a frame held for it, unless that
    // frame came from a write after ours (it holds ours and theirs): that one folds in next.
    const later = e.missed && e.missed._updatedAt > saved._updatedAt ? e.missed : undefined
    e.missed = undefined
    e.conflicts = 0
    clearTimeout(stall)
    keepUnsaved(id, e)
    applyServer(qc, saved)
    if (later) applyServer(qc, later)
    setState(e, e.dirty.size ? 'saving' : 'saved')
  } catch (err) {
    clearTimeout(stall)
    const msg = (err as Error).message ?? ''
    if (/^mutate 429\b/.test(msg)) paced(true)
    // Signed out, or not allowed: keep every value, say why, stop writing.
    if (/token_refused/.test(msg)) {
      e.dirty = new Map([...e.inflight!, ...e.dirty])
      e.inflight = null
      return setState(e, 'refused', reasonOf(msg) ?? "Barkpark refused this studio's token.")
    }
    if (/^mutate 401\b/.test(msg) || /session_lost/.test(msg)) {
      e.dirty = new Map([...e.inflight!, ...e.dirty])
      e.inflight = null
      return setState(e, 'signedOut', "You've been logged out")
    }
    // A refusal still folds in a frame that came while it was on its way (rebase kept it
    // for afterInflight): a text of ours rewrote meanwhile is said, not hidden behind the
    // refusal until the next save 412s (the form-refused flake on a cold server).
    // Too large (413) goes no better a second time: stop retrying, say why, keep every value
    // (this browser's store too) and offer Retry; an edit (taking content out) tries again too.
    if (/^mutate 413\b/.test(msg)) {
      e.dirty = new Map([...e.inflight!, ...e.dirty])
      e.inflight = null
      keepUnsaved(id, e)
      return setState(e, 'refused', t('This document is too large to save. Remove some content.'), true)
    }
    if (/^mutate 403\b/.test(msg)) {
      if (afterInflight(qc, id, e)) return
      return setState(e, 'refused', reasonOf(msg) ?? 'Barkpark refused the change')
    }
    // J32 widen: the doc was deleted (by someone else) under these edits. Keep every value,
    // here and in this browser's store, and stop: the deleted banner's Restore puts them back.
    if (/^mutate 404\b/.test(msg)) {
      e.dirty = new Map([...e.inflight!, ...e.dirty])
      e.inflight = null
      keepUnsaved(id, e)
      // The 404 is proof enough: read the doc again, so the pane turns to the deleted
      // banner (and the list drops it) whether or not the live frame of the delete arrives.
      void qc.invalidateQueries({queryKey: ['doc', id]})
      void qc.invalidateQueries({queryKey: ['list', e.type]})
      return setState(e, 'refused', t('This document has been deleted.'))
    }
    // A validation refusal (a dataset that enforces its schema): say which fields and why,
    // in the editor's words; sending it again would only be refused again.
    const findings = findingsOf(msg)
    if (findings) {
      if (afterInflight(qc, id, e)) return
      const fields = qc.getQueryData(schemasQuery.queryKey)?.find((x) => x.name === e.type)?.fields ?? []
      return setState(e, 'refused', findingsReason(findings, (path) => fieldTitle(fields, path), t))
    }
    // No network: keep every value and wait for it, no error, no retry storm. The write may
    // have landed with its answer lost: a frame holding it is not theirs to merge in again.
    if (isNetworkError(err)) {
      for (const f of e.inflight!.keys()) (e.unsure ??= new Set()).add(f)
      e.dirty = new Map([...e.inflight!, ...e.dirty])
      e.inflight = null
      return waitForNetwork(qc, id, e)
    }
    // The create may have committed before its response was lost. Recover that
    // same generated id; keep later typing queued instead of creating a duplicate.
    if (creating && /^mutate 409\b|already been taken/.test(msg)) {
      try {
        const saved = await readServerDoc(e.type, id)
        if (saved) {
          e.pendingCreate = undefined
          e.createRequested = false
          e.dirty = new Map([...e.inflight!, ...e.dirty])
          e.inflight = null
          applyServer(qc, saved)
          setState(e, e.dirty.size ? 'saving' : 'saved')
          schedule(qc, id)
          return
        }
      } catch {
        // Keep the original create queued until its outcome can be read.
      }
    }
    // Someone else wrote first (a stale rev): read theirs, rebase ours onto it, send again.
    // (Two first edits forking one draft no longer collide: Barkpark fixed that,
    // task-324b4d00706a6cfb.)
    if (!creating && /^mutate (409|412)\b/.test((err as Error).message) && e.conflicts++ < 5) {
      try {
        const latest = await readServerDoc(e.type, id)
        e.dirty = new Map([...e.inflight!, ...e.dirty])
        e.inflight = null
        e.missed = undefined // the latest read supersedes it
        const clashed = latest ? rebase(e, latest) : []
        if (latest) writeCache(qc, id, e.type, overlay(id, latest))
        if (clashed.length && latest) return clash(qc, id, e, clashed, latest)
        void send(qc, id)
        return
      } catch {
        // fall through: a plain failure, retried below
      }
    }
    // Keep every value: put the failed batch back under anything typed since, retry. A
    // failure with no clear refusal may still have saved it.
    for (const f of e.inflight!.keys()) (e.unsure ??= new Set()).add(f)
    if (afterInflight(qc, id, e)) return
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
  e.pendingCreate = fields
  e.createRequested = true
  e.dirty = new Map(Object.entries(fields))
  writeCache(qc, id, type, {_id: `drafts.${id}`, _publishedId: id, _type: type, _draft: true, _hasPublished: false, _rev: '', _updatedAt: '', ...fields} as Doc)
  setState(e, 'saving')
  // Reuse the edit queue's offline, refusal and retry handling. Callers that set
  // a parent reference wait for actual creation, including after a reconnect.
  await new Promise<void>((resolve) => {
    const check = () => {
      if (e.pendingCreate) return
      listeners.delete(check)
      resolve()
    }
    listeners.add(check)
    schedule(qc, id)
  })
}

/** Resolves once nothing typed into `id` is waiting or in flight. */
export function whenSaved(id: string): Promise<void> {
  const idle = () => {
    const e = docs.get(id)
    return !e || (!e.inflight && !e.timer && e.dirty.size === 0 && !e.createRequested)
  }
  if (idle()) return Promise.resolve()
  return new Promise((resolve) => {
    const check = () => idle() && (listeners.delete(check), resolve())
    listeners.add(check)
  })
}

/** Publish what the editor sees: unsent edits go first. */
export async function publish(qc: QueryClient, doc: Doc, {slugsChecked = false} = {}) {
  const id = doc._publishedId
  flush(qc, id)
  await whenSaved(id)
  const now = qc.getQueryData<Doc>(['doc', id])
  if (!now?._draft) return // nothing to publish
  // A slug someone else took since the form last asked is refused here, as Sanity's publish does.
  // (A bulk publish asked for all its docs at once: slugsTakenAmong.)
  const taken = slugsChecked ? [] : await slugsTakenNow(qc, now, qc.getQueryData(schemasQuery.queryKey)?.find((x) => x.name === doc._type))
  if (taken.length) throw new Error(`${taken.join(', ')}: ${t('Slug is already in use')}`)
  const r = (await mutate({data: {mutations: [{publish: {id, type: doc._type}}]}})) as {results: {document: Doc}[]}
  applyServer(qc, r.results[0].document)
  qc.setQueryData(['doc-published', id], r.results[0].document)
}

/** A field's clash, if one holds (the inline card), and the editor's own unsent value there. */
export function useFieldClash(id: string | null, field: string): (FieldClash & {mine: unknown}) | null {
  const c = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => (id ? docs.get(id)?.clashes?.get(field) : undefined),
    () => undefined,
  )
  return c && id ? {...c, mine: docs.get(id)?.dirty.get(field)} : null
}

/** The card's answer for one clashed field: "Keep mine" sends mine over theirs; "Take theirs" drops mine. */
export function settleClash(qc: QueryClient, id: string, field: string, keep: 'mine' | 'theirs') {
  const e = docs.get(id)
  const c = e?.clashes?.get(field)
  if (!e || !c) return
  e.clashes = new Map(e.clashes)
  e.clashes.delete(field)
  if (keep === 'theirs') {
    e.dirty.delete(field)
    e.base.delete(field)
    const held = qc.getQueryData<Doc>(['doc', id])
    if (held) writeCache(qc, id, e.type, setPath({...held}, field, c.theirs))
  }
  if (e.clashes.size) return listeners.forEach((l) => l())
  e.clashes = undefined
  e.held = false
  keepUnsaved(id, e)
  if (!e.dirty.size && !e.inflight) return setState(e, 'saved')
  setState(e, 'saving')
  schedule(qc, id)
}

const NO_FINDINGS: Finding[] = []
/** Barkpark's advisory findings on this doc's last save (lib/findings.ts says them). */
export function useAdvisories(id: string): Finding[] {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => docs.get(id)?.advisories ?? NO_FINDINGS,
    () => NO_FINDINGS,
  )
}

/**
 * A Freeform canvas in a field (the body) saves on its own; when it can't (refused, a
 * conflict), the document's footer says so too, as for any field (collaboration hour:
 * the footer said "Last published …" while the body's edit was not saved).
 */
const canvasSnaps = new Map<string, Snap>()
const canvasProblems = new Map<string, Map<string, string>>()
export function setCanvasProblem(docId: string, key: string, message: string | null) {
  const held = canvasProblems.get(docId) ?? new Map<string, string>()
  if (message) held.set(key, message)
  else held.delete(key)
  canvasProblems.set(docId, held)
  const first = [...held.values()][0]
  if (first) canvasSnaps.set(docId, {state: 'refused', error: first})
  else canvasSnaps.delete(docId)
  listeners.forEach((l) => l())
}

/** A canvas holding a batch until the network is back: the footer says offline, as for a field. */
const canvasOffline = new Map<string, Set<string>>()
const OFFLINE: Snap = {state: 'offline'}
export function setCanvasOffline(docId: string, key: string, on: boolean) {
  const held = canvasOffline.get(docId) ?? new Set<string>()
  if (on === held.has(key)) return
  if (on) held.add(key)
  else held.delete(key)
  canvasOffline.set(docId, held)
  setFooterOffline(anyOffline())
  listeners.forEach((l) => l())
}

export function useSaveState(id: string): Snap {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => {
      const own = docs.get(id)?.snap ?? SAVED
      const canvas = canvasSnaps.get(id) ?? (canvasOffline.get(id)?.size ? OFFLINE : undefined)
      return canvas && (own.state === 'saved' || own.state === 'saving') ? canvas : own
    },
    () => SAVED,
  )
}

/** Delete a document (draft and published). The server is the judge of whether it may. */
export async function deleteDoc(qc: QueryClient, doc: Doc) {
  const id = doc._publishedId
  await mutate({data: {mutations: [{delete: {id, type: doc._type}}]}})
  docs.delete(id)
  const key = docKeyOf(id)
  if (key) void readDocPending(key).then((all) => all.forEach(([k]) => void dropPending(k)))
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
  historyChanged(qc, id)
}

/** Discard the draft: back to the published version; anything unsent is dropped too. */
export async function discardDraft(qc: QueryClient, doc: Doc) {
  const id = doc._publishedId
  const e = docs.get(id)
  if (e) (clearTimeout(e.timer), (e.timer = undefined), e.dirty.clear(), keepUnsaved(id, e))
  await whenSaved(id)
  await mutate({data: {mutations: [{discardDraft: {id, type: doc._type}}]}})
  if (e) e.advisories = undefined // what Barkpark said of the draft went with it
  const published = qc.getQueryData<Doc | null>(['doc-published', id])
  if (published) writeCache(qc, id, doc._type, {...published, _hasPublished: true} as Doc)
  historyChanged(qc, id)
  await qc.invalidateQueries({queryKey: ['doc', id]})
}

export type Recovered = {pending: Pending; fields: [string, unknown][]; gone?: string[]; keys: string[]}
/**
 * B11 widen: on open, edits this browser kept for `doc` that never reached Barkpark (a
 * reload or crash). Same server rev → sent again now, quietly (`replayed`); a newer rev →
 * returned for the pane to offer (`ask`). Nothing when the page that wrote them is still open.
 */
export async function recoverPending(qc: QueryClient, doc: Doc, schema?: Schema): Promise<{replayed: number} | {ask: Recovered} | null> {
  const id = doc._publishedId
  const e = docs.get(id)
  if (!docKeyOf(id) || doc._rev === '' || (e && (e.dirty.size || e.inflight || e.pendingCreate))) return null
  const kept = await orphaned(id)
  if (!kept) return null
  const {keys, pending} = kept
  const verdict = judge(pending, doc, schema)
  if (verdict.kind === 'drop') return (keys.forEach((k) => void dropPending(k)), null)
  if (verdict.kind === 'ask') return {ask: {pending, fields: verdict.fields, gone: verdict.gone, keys}}
  for (const [f, v] of verdict.fields) edit(qc, qc.getQueryData<Doc>(['doc', id]) ?? doc, f, v)
  // Now this page's own edits (kept under its own entry): the dead pages' entries go.
  keys.forEach((k) => void dropPending(k))
  return {replayed: pending.at}
}

/** Restore kept edits over the document as it is now (text merges with what changed since). */
export function restorePending(qc: QueryClient, doc: Doc, {pending, fields, keys}: Recovered) {
  for (const [f, v] of fields) {
    const now = qc.getQueryData<Doc>(['doc', doc._publishedId]) ?? doc
    edit(qc, now, f, restoreValue(pending, f, v, now))
  }
  keys.forEach((k) => void dropPending(k))
}

export function discardPending({keys}: Recovered) {
  keys.forEach((k) => void dropPending(k))
}

/**
 * J32 widen: edits to `id` that never reached Barkpark, from this page or kept in this
 * browser from an earlier one, with when they were made; null when there are none.
 */
export async function unsavedFor(id: string): Promise<{at: number; fields: [string, unknown][]} | null> {
  const e = docs.get(id)
  if (e && (e.dirty.size || e.inflight)) return {at: Date.now(), fields: [...(e.inflight ?? []), ...e.dirty]}
  const p = (await orphaned(id))?.pending
  return p && p.fields.length ? {at: p.at, fields: p.fields} : null
}

/** J32 widen: after a deleted doc is restored, put the edits it lost back on top and send them. */
export function reapply(qc: QueryClient, restored: Doc, fields: [string, unknown][]) {
  const id = restored._publishedId
  const e = entry(id, restored._type)
  clearTimeout(e.timer)
  e.timer = undefined
  e.dirty = new Map()
  e.inflight = null
  e.missed = undefined
  e.base.clear()
  setState(e, 'saved')
  // The edits are made against the restored version, not against what the screen shows
  // (it already shows them): with the screen as base, a newer version from Barkpark
  // meanwhile read as "the editor changed nothing" and theirs replaced the typing.
  e.rev = restored._rev
  for (const [f] of fields) e.base.set(f, getPath(restored, f))
  for (const [f, v] of fields) edit(qc, qc.getQueryData<Doc>(['doc', id]) ?? restored, f, v)
  flush(qc, id)
}
