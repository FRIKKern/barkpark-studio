// `visual-editing/mutate`: a write the preview page asks for (its overlay's array menu, a
// drag). Sanity's Presentation passes the page's transaction to the Content Lake as it is.
// Here the page is another origin asking the editor's studio to write, so nothing of the
// transaction is passed on. It is read for what the editor did on the page, one of:
//
//   move      an item to before / after another item of its array    (drag, Move up / down / to top / to bottom)
//   remove    an item
//   duplicate an item, the copy beside it
//   insert    a new, empty item of one of the array's member types
//
// and that is done again on the studio's own copy of the document, by `_key`: the items are
// the studio's (the page's copy of an item is never written), into an array the schema has,
// through the form's own write (lib/edits.ts). Anything else in the transaction refuses all
// of it: a set, another document, a published or version id, a field the schema lacks.
// Pure: the channel is lib/presentation-overlay.ts.
//
//   page ── mutate {mutations: [createIfNotExists, patch…]} ──▶ pageEdit ──▶ {id, path, op}
//                                                                  │ arrayField (the schema's array, not read-only)
//                                                                  ▼
//                           the studio's array ──▶ applyArrayOp ──▶ the next array ──▶ edit()

import type {Field, Schema} from './data'
import {memberFor, memberName, membersOf, newMemberItem} from './array-members.ts'
import {pathSteps} from './presentation-comlink.ts'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const ownKeys = (v: Obj) => Object.keys(v).sort().join(',')

/** A page's transaction, as text: its copy of the document rides in it (createIfNotExists). */
export const MUTATE_MAX = 512_000
/** Changes a page may make in a minute: each is a write on the editor's own budget. */
export const MUTATES_A_MINUTE = 30
/** Items an array may hold for a page to add one more. */
export const ITEMS_MAX = 1_000

const DOC_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const KEY = /^[A-Za-z0-9_.:-]{1,64}$/
const NEW_KEY = /^[A-Za-z0-9_-]{1,64}$/
const TYPE = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype'])
const KEYED = /^(.+)\[_key=="([^"\]]+)"\]$/
const RANGE = /^(.+)\[(\d{1,6}):(\d{1,6})\]$/
const INDEX = /^(.+)\[(-1|\d{1,6})\]$/

export type ArrayOp =
  | {kind: 'move'; key: string; position: 'before' | 'after'; ref: string}
  | {kind: 'remove'; key: string}
  | {kind: 'duplicate'; key: string; newKey: string; position: 'before' | 'after'}
  | {kind: 'insert'; member: string; newKey: string; position: 'before' | 'after'; ref: string}
/** What the page asked: in the document `id` (its published id), the array at `path`, `op`. */
export type PageEdit = {id: string; path: string; op: ArrayOp}
/** Why not. `stale`: the page acted on a copy the document has moved on from (not a forgery). */
export type Refusal = {refused: string; stale?: true}
const no = (refused: string): Refusal => ({refused})

/** An array's path: names and keyed items only, ending on a field; no name a prototype has. */
function arrayPath(path: string): boolean {
  const steps = pathSteps(path)
  if (!steps?.length || steps.some((s) => 'index' in s || ('name' in s && UNSAFE.has(s.name)) || ('key' in s && !KEY.test(s.key)))) return false
  return 'name' in steps[steps.length - 1]!
}

/** The item keys, in order, of the array at `path` in the page's own copy; null when it holds no such array. */
function keysAt(doc: unknown, path: string): string[] | null {
  let value: unknown = doc
  for (const step of pathSteps(path) ?? []) {
    if ('name' in step) value = isObj(value) && Object.hasOwn(value, step.name) ? value[step.name] : undefined
    else if ('key' in step) value = Array.isArray(value) ? value.find((x) => isObj(x) && x._key === step.key) : undefined
  }
  if (!Array.isArray(value) || value.length > 10_000) return null
  const keys = value.map((x) => (isObj(x) && typeof x._key === 'string' ? x._key : null))
  return keys.every((k): k is string => k !== null && KEY.test(k)) && new Set(keys).size === keys.length ? keys : null
}

const itemAt = (doc: unknown, path: string, key: string): unknown => {
  let value: unknown = doc
  for (const step of pathSteps(`${path}[_key=="${key}"]`) ?? []) {
    if ('name' in step) value = isObj(value) && Object.hasOwn(value, step.name) ? value[step.name] : undefined
    else if ('key' in step) value = Array.isArray(value) ? value.find((x) => isObj(x) && x._key === step.key) : undefined
  }
  return value
}

const withoutKey = (item: unknown) => (isObj(item) ? JSON.stringify({...item, _key: undefined}) : undefined)

type Unset = {path: string; key?: string; index?: number}
type Insert = {path: string; position: 'before' | 'after'; ref?: string; index?: number; item: Obj; key: string}

function unsetOf(patch: Obj): Unset | null {
  const list = patch.unset
  if (!Array.isArray(list) || list.length !== 1 || typeof list[0] !== 'string' || list[0].length > 600) return null
  const keyed = KEYED.exec(list[0])
  if (keyed) return arrayPath(keyed[1]!) && KEY.test(keyed[2]!) ? {path: keyed[1]!, key: keyed[2]!} : null
  const range = RANGE.exec(list[0])
  return range && arrayPath(range[1]!) && Number(range[3]) === Number(range[2]) + 1 ? {path: range[1]!, index: Number(range[2])} : null
}

function insertOf(patch: Obj): Insert | null {
  const insert = patch.insert
  if (!isObj(insert) || Object.keys(insert).length !== 2 || !Array.isArray(insert.items) || insert.items.length !== 1) return null
  const position = 'before' in insert ? 'before' : 'after' in insert ? 'after' : null
  const target = position && insert[position]
  const item = insert.items[0]
  if (!position || typeof target !== 'string' || target.length > 600 || !isObj(item) || typeof item._key !== 'string' || !KEY.test(item._key)) return null
  const keyed = KEYED.exec(target)
  if (keyed) return arrayPath(keyed[1]!) && KEY.test(keyed[2]!) ? {path: keyed[1]!, position, ref: keyed[2]!, item, key: item._key} : null
  const index = INDEX.exec(target)
  return index && arrayPath(index[1]!) ? {path: index[1]!, position, index: Number(index[2]), item, key: item._key} : null
}

/**
 * A `visual-editing/mutate` payload (the page's @sanity/mutate transaction) as the one array
 * change it makes, or why it is refused. The shapes are the ones @sanity/visual-editing
 * sends: a drag is `unset [a[_key=="k"]]` + `insert {after: a[_key=="r"]}`; the menu's moves
 * and Remove count by index (`unset [a[1:2]]`, `insert {before: a[0]}`), read here against
 * the copy of the document the page sends along, into keys.
 */
export function pageEdit(data: unknown): PageEdit | Refusal {
  if (!isObj(data) || !Array.isArray(data.mutations) || Object.keys(data).some((k) => k !== 'mutations' && k !== 'transactionId')) return no('not a transaction')
  if (data.mutations.length < 1 || data.mutations.length > 3) return no('more than one change at once')
  let size = 0
  try {
    size = JSON.stringify(data).length
  } catch {
    return no('not a transaction')
  }
  if (size > MUTATE_MAX) return no('the transaction is too large')
  const entries = data.mutations as unknown[]
  if (!entries.every((m): m is Obj => isObj(m) && Object.keys(m).length === 1)) return no('not a mutation')
  // Its own copy of the document may come first (the draft it would start from): read for its order only.
  const copy = isObj(entries[0]!.createIfNotExists) ? entries[0]!.createIfNotExists : undefined
  const patches = entries.slice(copy ? 1 : 0).map((m) => m.patch)
  if (!patches.length || patches.length > 2 || !patches.every(isObj)) return no('only array patches are taken from a page')
  const draft = patches[0]!.id
  // The draft, by its plain id: never the published document, a release version or a nested prefix.
  if (typeof draft !== 'string' || !draft.startsWith('drafts.')) return no('only a draft is written from a page')
  const id = draft.slice('drafts.'.length)
  if (!DOC_ID.test(id) || /^(drafts|versions)\./.test(id)) return no('not a document id')
  if (patches.some((p) => p.id !== draft) || (copy && copy._id !== draft)) return no('more than one document')
  const [first, second] = patches as [Obj, Obj | undefined]
  const view = (path: string) => (copy ? keysAt(copy, path) : null)

  if (second) {
    // A move: the item out, the same item in beside another.
    if (ownKeys(first) !== 'id,unset' || ownKeys(second) !== 'id,insert') return no('not an array move')
    const [out, into] = [unsetOf(first), insertOf(second)]
    if (!out || !into || out.path !== into.path) return no('not an array move')
    const keys = view(out.path)
    const key = out.key ?? keys?.[out.index!]
    if (!key || key !== into.key) return no('not an array move')
    let ref = into.ref
    if (ref === undefined) {
      const rest = keys?.filter((k) => k !== key)
      ref = rest?.[into.index === -1 ? rest.length - 1 : into.index!]
    }
    if (!ref || ref === key) return no('not an array move')
    return {id, path: out.path, op: {kind: 'move', key, position: into.position, ref}}
  }
  if (ownKeys(first) === 'id,unset') {
    const out = unsetOf(first)
    const key = out && (out.key ?? view(out.path)?.[out.index!])
    return out && key ? {id, path: out.path, op: {kind: 'remove', key}} : no('not an array item')
  }
  if (ownKeys(first) === 'id,insert') {
    const into = insertOf(first)
    if (!into || into.ref === undefined || !NEW_KEY.test(into.key)) return no('not an array insert')
    if (view(into.path)?.includes(into.key)) return no('the new item takes a key in use')
    const fields = Object.keys(into.item).filter((k) => k !== '_key')
    // Sanity's Insert before / after: an empty item of a member type.
    if (fields.length === 0 || (fields.length === 1 && fields[0] === '_type')) {
      const member = into.item._type ?? ''
      if (typeof member !== 'string' || (member && !TYPE.test(member))) return no('not an array insert')
      return {id, path: into.path, op: {kind: 'insert', member, newKey: into.key, position: into.position, ref: into.ref}}
    }
    // Sanity's Duplicate: the page's own copy of the item beside it, under a new key. Any
    // other content is an item of the page's making, which is never written.
    const original = copy && itemAt(copy, into.path, into.ref)
    if (!original || withoutKey(original) !== withoutKey(into.item)) return no('an item of the page\'s own making')
    return {id, path: into.path, op: {kind: 'duplicate', key: into.ref, newKey: into.key, position: into.position}}
  }
  return no('only array patches are taken from a page')
}

/**
 * The schema's array at `path` in a document of `schema`, when a page may change it: an
 * arrayOf of keyed items (objects, references, images: not strings), reached through fields
 * that are neither hidden nor read-only. `doc` says which member a keyed step's item is.
 */
export function arrayField(schema: Pick<Schema, 'fields'> | undefined, path: string, doc: unknown): Field | null {
  const steps = pathSteps(path)
  if (!schema || !steps || !arrayPath(path)) return null
  let fields: Field[] | undefined = schema.fields
  let array: Field | undefined
  let value: unknown = doc
  for (const step of steps) {
    if ('name' in step) {
      const field: Field | undefined = fields?.find((f) => f.name === step.name)
      // A condition on readOnly is the form's to judge: from a page it reads as locked.
      if (!field || field.hidden || field.readOnly) return null
      value = isObj(value) && Object.hasOwn(value, step.name) ? value[step.name] : undefined
      array = field.type === 'arrayOf' ? field : undefined
      fields = field.type === 'composite' ? field.fields : undefined
    } else if ('key' in step) {
      const item: unknown = Array.isArray(value) ? value.find((x) => isObj(x) && x._key === step.key) : undefined
      const member: Field | undefined = array && item !== undefined ? memberFor(membersOf(array), item) : undefined
      if (!member || member.readOnly) return null
      value = item
      array = member.type === 'arrayOf' ? member : undefined
      fields = member.type === 'composite' ? member.fields : undefined
    } else return null
  }
  const members = array ? membersOf(array) : []
  return array && members.length && members.every((m) => m.type === 'composite' || m.type === 'reference' || m.type === 'image' || m.type === 'file') ? array : null
}

/** A new, empty item of `member`, as the form's "Add item" makes one (components/ObjectArrayInput, RefArrayInput). */
function blankItem(members: Field[], member: Field, key: string): Obj {
  if (member.type === 'reference') return {_key: key, _type: 'reference'}
  if (members.length > 1) return newMemberItem(member, key)
  return member.type === 'image' ? {_type: 'image', _key: key} : {...member.initialValue, _key: key}
}

/**
 * `op` done on the studio's own array `value` (of `field`): the next array, or why not.
 * `same`: nothing to write (the item is already there). A key the array no longer has is
 * `stale`: the item went meanwhile (another editor, the form), and the page is told so.
 */
export function applyArrayOp(value: unknown, op: ArrayOp, field: Field): {next: Obj[]; same?: true} | Refusal {
  if (!Array.isArray(value) || !value.every((x): x is Obj => isObj(x) && typeof x._key === 'string')) return no('not an array of keyed items')
  const items = value as Obj[]
  const at = (key: string) => items.findIndex((x) => x._key === key)
  const gone = (what: string): Refusal => ({refused: `${what} is no longer in the array`, stale: true})
  const beside = (list: Obj[], ref: string, position: 'before' | 'after', item: Obj) => {
    const i = list.findIndex((x) => x._key === ref) + (position === 'after' ? 1 : 0)
    return [...list.slice(0, i), item, ...list.slice(i)]
  }
  if (op.kind === 'remove') return at(op.key) < 0 ? gone('the item') : {next: items.filter((x) => x._key !== op.key)}
  if (op.kind === 'move') {
    if (at(op.key) < 0 || at(op.ref) < 0) return gone(at(op.key) < 0 ? 'the item' : 'the item it was moved beside')
    const next = beside(items.filter((x) => x._key !== op.key), op.ref, op.position, items[at(op.key)]!)
    return next.every((x, i) => x === items[i]) ? {next: items, same: true} : {next}
  }
  if (items.length >= ITEMS_MAX) return no('the array is full')
  if (at(op.newKey) >= 0) return {refused: 'the new item takes a key in use', stale: true}
  if (op.kind === 'duplicate') return at(op.key) < 0 ? gone('the item') : {next: beside(items, op.key, op.position, {...items[at(op.key)]!, _key: op.newKey})}
  if (at(op.ref) < 0) return gone('the item it was added beside')
  const members = membersOf(field)
  const member = members.length === 1 ? members[0] : members.find((m) => memberName(m) === op.member)
  return member ? {next: beside(items, op.ref, op.position, blankItem(members, member, op.newKey))} : no('not a member of the array')
}

/**
 * Whether `value` (the array, once the save has settled) shows `op` done. A move made while
 * another editor reordered the same array is dropped by the list merge (lib/merge.ts: the
 * order that landed first stands): the channel then makes it once more, onto their order.
 */
export function holds(value: unknown, op: ArrayOp): boolean {
  const keys = Array.isArray(value) ? value.map((x) => (isObj(x) ? x._key : undefined)) : []
  if (op.kind === 'remove') return !keys.includes(op.key)
  if (op.kind !== 'move') return keys.includes(op.newKey)
  const [at, ref] = [keys.indexOf(op.key), keys.indexOf(op.ref)]
  return at >= 0 && ref >= 0 && at === ref + (op.position === 'after' ? 1 : -1)
}

// ── What a page has spent ──────────────────────────────────────────────────────────────

/** The frame is loaded again (a change not saved) at most this often; twice as long each time a page keeps at it. */
export const PUT_BACK_GAP = 5_000
export const PUT_BACK_GAP_MAX = 60_000
/** Snapshots a page may make the studio read in a minute (each a read on the editor's budget). */
export const SNAPSHOTS_A_MINUTE = 60

/**
 * A preview origin's tallies. They outlive the frame: putting a page back loads a new frame,
 * and a tally that began again with it let a page write 30 per reload, and reload without end.
 */
export type PageTally = {writes: number[]; snapshots: number[]; lastPutBack: number; gap: number}
const tallies = new Map<string, PageTally>()
export const newTally = (): PageTally => ({writes: [], snapshots: [], lastPutBack: -Infinity, gap: PUT_BACK_GAP})
/** The one tally of `origin`, for every frame the studio shows of it. */
export function tallyOf(origin: string): PageTally {
  const tally = tallies.get(origin) ?? newTally()
  tallies.set(origin, tally)
  return tally
}

/** Whether one more of a counted thing fits the minute; counted when it does. */
export function fits(stamps: number[], now: number, max: number): boolean {
  while (stamps.length && stamps[0]! <= now - 60_000) stamps.shift()
  if (stamps.length >= max) return false
  stamps.push(now)
  return true
}

/**
 * How long until the page may be put back: 0 is now (and it is counted). A page put back
 * again and again waits twice as long each time (5 s, 10 s … a minute); a quiet spell of
 * twice its gap brings the 5 s back.
 */
export function putBackIn(tally: PageTally, now: number): number {
  const since = now - tally.lastPutBack
  if (since < tally.gap) return tally.gap - since
  tally.gap = since < 2 * tally.gap ? Math.min(tally.gap * 2, PUT_BACK_GAP_MAX) : PUT_BACK_GAP
  tally.lastPutBack = now
  return 0
}
