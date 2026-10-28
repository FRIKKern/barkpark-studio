import type {Field} from './data'
import {refId} from './refs.ts'
import {makePatches, stringifyPatches} from '@sanity/diff-match-patch'

// S4a (task-7f77f41c95cc6d9f): Portable Text in a richText field, edited with
// @portabletext/editor. S4b: annotations. S4c: custom blocks and inline objects. The jobs
// live here, apart from React so a unit test can run them:
// - the editor's schema, from the field's `blocks` declaration plus whatever the stored
//   value already holds, so the editor never drops a type it was not told about;
// - the value to save: blocks and spans the author did not touch go back exactly as
//   they were stored, and only the edited ones take the editor's version;
// - the fields a dialog for an annotation, a custom block or an inline object shows, and
//   the value it stores.

type Obj = Record<string, unknown>
export type PtBlock = Obj & {_type: string; _key?: string}
type Named = {name: string; title?: string}
/** A field as @portabletext/editor's schema takes it: the editor keeps only the fields it is told. */
type PtField = {name: string; type: 'string' | 'number' | 'boolean' | 'object'}
type NamedWithFields = Named & {fields?: PtField[]}
export type PtVocabulary = {
  styles: Named[]
  lists: Named[]
  decorators: Named[]
  annotations: Named[]
  blockObjects: Named[]
  inlineObjects: Named[]
}
/** A schema in @portabletext/editor's SchemaDefinition shape. */
export type PtSchema = Omit<PtVocabulary, 'annotations' | 'blockObjects' | 'inlineObjects'> & {block: {name: 'block'}; annotations: NamedWithFields[]; blockObjects: NamedWithFields[]; inlineObjects: NamedWithFields[]}

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const isText = (b: unknown): b is PtBlock => isObj(b) && b._type === 'block'

// Sanity's defaults for a block with no styles, lists or marks of its own.
const DEFAULT_STYLES = ['normal', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote']
const DEFAULT_LISTS = ['bullet', 'number']
const DEFAULT_DECORATORS = ['strong', 'em', 'code', 'underline', 'strike-through']
const DEFAULT_ANNOTATIONS = ['link']
// Barkpark's vocabulary spells it without the hyphen; Portable Text stores the hyphen.
const MARK_ALIAS: Record<string, string> = {strikethrough: 'strike-through'}

/** One entry of a declaration: a bare name, Sanity's {title, value}, or {name, title}. */
function named(entry: unknown, alias: Record<string, string> = {}): Named | null {
  if (typeof entry === 'string') return entry ? {name: alias[entry] ?? entry} : null
  if (!isObj(entry)) return null
  const name = typeof entry.name === 'string' ? entry.name : typeof entry.value === 'string' ? entry.value : typeof entry.type === 'string' ? entry.type : ''
  if (!name) return null
  return {name: alias[name] ?? name, ...(typeof entry.title === 'string' && {title: entry.title})}
}

const list = (v: unknown, fallback: string[], alias?: Record<string, string>): Named[] =>
  Array.isArray(v) ? v.map((e) => named(e, alias)).filter((n): n is Named => !!n) : fallback.map((name) => ({name}))

/** The field's declared vocabulary (its `blocks`), Sanity's defaults where it names none. */
export function declaredVocabulary(field: Pick<Field, 'blocks'>): PtVocabulary {
  const b = isObj(field.blocks) ? field.blocks : {}
  return {
    styles: list(b.styles, DEFAULT_STYLES),
    lists: list(b.lists, DEFAULT_LISTS),
    decorators: list(b.marks ?? b.decorators, DEFAULT_DECORATORS, MARK_ALIAS),
    annotations: list(b.annotations, DEFAULT_ANNOTATIONS),
    blockObjects: list(b.of, []),
    inlineObjects: list(b.inline, []),
  }
}

/** What the stored value holds, by kind: every name the editor must know to keep it. */
export function observedVocabulary(value: unknown): PtVocabulary {
  const seen = {styles: new Set<string>(), lists: new Set<string>(), decorators: new Set<string>(), annotations: new Set<string>(), blockObjects: new Set<string>(), inlineObjects: new Set<string>()}
  for (const b of Array.isArray(value) ? value : []) {
    if (!isObj(b) || typeof b._type !== 'string') continue
    if (b._type !== 'block') {
      seen.blockObjects.add(b._type)
      continue
    }
    if (typeof b.style === 'string') seen.styles.add(b.style)
    if (typeof b.listItem === 'string') seen.lists.add(b.listItem)
    const defs = new Set<string>()
    for (const d of Array.isArray(b.markDefs) ? b.markDefs : []) {
      if (!isObj(d)) continue
      if (typeof d._type === 'string') seen.annotations.add(d._type)
      if (typeof d._key === 'string') defs.add(d._key)
    }
    for (const c of Array.isArray(b.children) ? b.children : []) {
      if (!isObj(c)) continue
      if (typeof c._type === 'string' && c._type !== 'span') seen.inlineObjects.add(c._type)
      // A mark that names no markDef of its block is a decorator, declared or not.
      for (const m of Array.isArray(c.marks) ? c.marks : []) if (typeof m === 'string' && !defs.has(m)) seen.decorators.add(m)
    }
  }
  const out = (s: Set<string>) => [...s].map((name) => ({name}))
  return {styles: out(seen.styles), lists: out(seen.lists), decorators: out(seen.decorators), annotations: out(seen.annotations), blockObjects: out(seen.blockObjects), inlineObjects: out(seen.inlineObjects)}
}

// An image block (Sanity's `image` in blocks.of) holds its asset, hotspot and crop beside its own fields.
const IMAGE_PARTS = ['asset', 'hotspot', 'crop'].map((name) => ({name, type: 'object'}) as Field)

const union = (a: Named[], b: Named[]) => [...a, ...b.filter((n) => !a.some((m) => m.name === n.name))]

/**
 * The editor's schema: the declared vocabulary plus every name the stored value uses.
 * The toolbar offers the declared ones only; the rest are there so the editor keeps them.
 */
export function editorSchema(field: Pick<Field, 'blocks'>, value: unknown, schemas: SchemaLike[] = []): PtSchema {
  const d = declaredVocabulary(field)
  const o = observedVocabulary(value)
  // `normal` is always a style: a new paragraph takes it.
  const styles = union(d.styles.some((s) => s.name === 'normal') ? d.styles : [{name: 'normal'}, ...d.styles], o.styles)
  return {
    block: {name: 'block'},
    styles,
    lists: union(d.lists, o.lists),
    decorators: union(d.decorators, o.decorators),
    // Each with every field it may hold: the editor drops a markDef field it was not told.
    annotations: union(d.annotations, o.annotations).map((a) => ({...a, fields: editorFields(objectFields(field, 'annotation', a.name, value, schemas), storedObjects(value, 'annotation', a.name))})),
    blockObjects: union(d.blockObjects, o.blockObjects).map((b) => ({...b, fields: editorFields([...(b.name === 'image' ? IMAGE_PARTS : []), ...objectFields(field, 'block', b.name, value, schemas)], storedObjects(value, 'block', b.name))})),
    inlineObjects: union(d.inlineObjects, o.inlineObjects).map((i) => ({...i, fields: editorFields(objectFields(field, 'inline', i.name, value, schemas), storedObjects(value, 'inline', i.name))})),
  }
}

/** A rich text field holding Portable Text (an array with a text block), or declared as such. */
export function isPortableTextField(field: Pick<Field, 'type' | 'format'>, value: unknown): boolean {
  if (field.type !== 'richText') return false
  if (Array.isArray(value)) return value.some((b) => isText(b) && Array.isArray(b.children))
  return field.format === 'portableText' && (value === undefined || value === null)
}

/** Deep equality that ignores key order (the editor writes keys in its own order). */
export function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => equal(x, b[i]))
  if (!isObj(a) || !isObj(b) || Array.isArray(b)) return false
  const ka = Object.keys(a).filter((k) => a[k] !== undefined)
  const kb = Object.keys(b).filter((k) => b[k] !== undefined)
  return ka.length === kb.length && ka.every((k) => equal(a[k], b[k]))
}

type Keyed = {_key: string}
/** A change another editor made, as @portabletext/editor's `patches` event takes it. */
export type RemotePatch =
  | {type: 'set'; path: Keyed[]; value: PtBlock; origin: 'remote'}
  | {type: 'unset'; path: Keyed[]; origin: 'remote'}
  | {type: 'insert'; path: Keyed[]; position: 'before' | 'after'; items: PtBlock[]; origin: 'remote'}
  | {type: 'diffMatchPatch'; path: [Keyed, 'children', Keyed, 'text']; value: string; origin: 'remote'}

/** A span's text in a Portable Text value, by block and span key ('' when it has none). */
export function spanText(value: unknown, block: string, span: string): string {
  const b = Array.isArray(value) ? (value as PtBlock[]).find((x) => x?._key === block) : undefined
  const t = (Array.isArray(b?.children) ? (b.children as Obj[]) : []).find((c) => c._key === span)?.text
  return typeof t === 'string' ? t : ''
}

/**
 * The editor's own changes as span text patches (it emits each typed or removed letter as
 * diff-match-patch on `[{_key: block}, 'children', {_key: span}, 'text']`), when that is all
 * the change was: a save applies them onto the span as stored now, as Sanity's server does.
 * Null when anything else changed.
 */
export function textPatches(patches: unknown[]): {block: string; span: string; value: string}[] | null {
  const out: {block: string; span: string; value: string}[] = []
  for (const p of patches as {type?: string; path?: unknown[]; value?: unknown}[]) {
    const [block, children, span, text] = p.path ?? []
    const key = (s: unknown) => (isObj(s) && typeof s._key === 'string' && /^[\w-]+$/.test(s._key) ? s._key : null)
    if (p.type !== 'diffMatchPatch' || p.path!.length !== 4 || children !== 'children' || text !== 'text' || !key(block) || !key(span) || typeof p.value !== 'string') return null
    out.push({block: key(block)!, span: key(span)!, value: p.value})
  }
  return out.length ? out : null
}

/**
 * The span texts `next` changed from `prev`, when nothing else did (same spans in the same
 * order, same marks, same block): another editor's typing comes in as diff-match-patch
 * into each span, not as the whole block. Null when more than text changed.
 */
export function spanTextChanges(prev: unknown, next: unknown): {span: string; text: string}[] | null {
  if (!isText(prev) || !isText(next) || !Array.isArray(prev.children) || !Array.isArray(next.children)) return null
  const blank = (b: PtBlock) => ({...b, children: (b.children as Obj[]).map((c) => (c._type === 'span' ? {...c, text: ''} : c))})
  if (prev.children.length !== next.children.length || !equal(asEditorHolds(blank(prev)), asEditorHolds(blank(next)))) return null
  const out: {span: string; text: string}[] = []
  for (let i = 0; i < next.children.length; i++) {
    const a = prev.children[i] as Obj
    const b = next.children[i] as Obj
    if (b._type !== 'span' || typeof b._key !== 'string' || !/^[\w-]+$/.test(b._key)) return null
    if (a.text !== b.text) out.push({span: b._key, text: typeof b.text === 'string' ? b.text : ''})
  }
  return out
}

/** A block as the editor holds it: its defaults filled in (style, markDefs, each span's marks). */
export function asEditorHolds(b: unknown): unknown {
  if (!isText(b)) return b
  const children = Array.isArray(b.children) ? b.children.map((c) => (isObj(c) && c._type === 'span' && !('marks' in c) ? {...c, marks: []} : c)) : b.children
  return {style: 'normal', markDefs: [], ...b, children}
}

/**
 * Another editor's changes (`known` → `incoming`, the stored value before and now) as
 * patches onto what this editor shows: a block it changed, came or went, where this editor
 * has not touched that block (it still shows it as `known` had it). A block this editor is
 * typing in keeps its own version (its save and the field's fence decide), and so does one
 * whose incoming version is one this editor itself sent (`sent`): an echo, maybe an older
 * one, never theirs. A block in `keep` (this editor sent it a moment ago: the value it came
 * in may hold that unconfirmed) is not taken away; if it is gone there, the save says so.
 * `seen` (by `block/span`) is each span's text as this editor has accounted for it, updated
 * here; `echo` tells a text this editor itself wrote a moment ago (an older echo of its own).
 */
export function remoteBlockPatches(known: unknown, incoming: unknown, shown: unknown, sent: unknown[] = [], keep: Set<string> = new Set(), seen: Map<string, string> = new Map(), echo: (span: string, text: string) => boolean = () => false): RemotePatch[] {
  if (!Array.isArray(known) || !Array.isArray(incoming) || !Array.isArray(shown)) return []
  const byKey = (list: unknown[]) => new Map(list.filter((b): b is PtBlock => isObj(b) && typeof b._key === 'string').map((b) => [b._key!, b]))
  const was = byKey(known)
  const now = byKey(incoming)
  const here = byKey(shown)
  const mine = sent.filter(Array.isArray).map((v) => byKey(v as unknown[]))
  const ours = (k: string, b: PtBlock) => mine.some((m) => m.has(k) && equal(m.get(k), b))
  const untouched = (k: string) => here.has(k) && was.has(k) && equal(asEditorHolds(here.get(k)), asEditorHolds(was.get(k)))
  const out: RemotePatch[] = []
  for (const k of was.keys()) if (!now.has(k) && untouched(k) && !keep.has(k)) out.push({type: 'unset', path: [{_key: k}], origin: 'remote'})
  // A block changed there. Span texts alone: diff-match-patch into each span (as Sanity's),
  // so the caret, this editor's own typing and its undo steps stay. Measured from the text
  // this editor has accounted for (`seen`: its own changes and theirs it was given), so its
  // own words are never given back to it. More than text: the block, where untouched.
  for (const [k, b] of now) {
    const old = was.get(k)
    const mine = here.get(k)
    if (!old || !mine || equal(old, b) || ours(k, b)) continue
    const theirs = spanTextChanges(old, b)
    if (theirs && spanTextChanges(old, mine)) {
      for (const {span, text} of theirs) {
        const from = seen.get(`${k}/${span}`) ?? (((old.children as Obj[]).find((c) => c._key === span)?.text ?? '') as string)
        if (text === from || echo(`${k}/${span}`, text)) continue
        out.push({type: 'diffMatchPatch', path: [{_key: k}, 'children', {_key: span}, 'text'], value: stringifyPatches(makePatches(from, text)), origin: 'remote'})
        seen.set(`${k}/${span}`, text)
      }
    } else if (untouched(k)) out.push({type: 'set', path: [{_key: k}], value: b, origin: 'remote'})
  }
  // New blocks, in place: after the block before them that this editor has (or will have).
  const present = new Set([...here.keys()].filter((k) => now.has(k) || !was.has(k)))
  let prev: string | undefined
  for (const [k, b] of now) {
    if (!was.has(k) && !here.has(k)) {
      const first = [...here.keys()].find((x) => present.has(x))
      if (prev) out.push({type: 'insert', path: [{_key: prev}], position: 'after', items: [b], origin: 'remote'})
      else if (first) out.push({type: 'insert', path: [{_key: first}], position: 'before', items: [b], origin: 'remote'})
      else continue
      present.add(k)
    }
    if (present.has(k)) prev = k
  }
  return out
}

/**
 * `value` with another editor's patches applied: what the editor holds after them, minus
 * its own typing not yet emitted (a save is measured from this, so that typing still goes).
 */
export function withRemote(value: unknown, patches: RemotePatch[]): PtBlock[] {
  let out = (Array.isArray(value) ? value : []) as PtBlock[]
  for (const p of patches) {
    const k = p.path[0]!._key
    const at = out.findIndex((b) => b._key === k)
    if (p.type === 'unset') out = out.filter((b) => b._key !== k)
    else if (p.type === 'diffMatchPatch') continue // the editor's text: its next change is sent as patches, not measured from this
    else if (p.type === 'set') out = at < 0 ? out : out.map((b, i) => (i === at ? p.value : b))
    else if (at >= 0) out = [...out.slice(0, p.position === 'after' ? at + 1 : at), ...p.items, ...out.slice(p.position === 'after' ? at + 1 : at)]
  }
  return out
}

/**
 * The blocks an edit changed, by key, when no block came, went or moved: what a save can
 * send as `body[_key=="…"]` sets instead of the whole field (task-283bdc577aedb167). Null
 * when one did (or a block has no plain key): the whole field goes.
 */
export function changedBlocks(prev: unknown, next: unknown): {key: string; block: PtBlock}[] | null {
  if (!Array.isArray(prev) || !Array.isArray(next) || prev.length !== next.length) return null
  const out: {key: string; block: PtBlock}[] = []
  for (let i = 0; i < next.length; i++) {
    const a = prev[i] as PtBlock
    const b = next[i] as PtBlock
    if (!isObj(a) || !isObj(b) || typeof b._key !== 'string' || !/^[\w-]+$/.test(b._key) || a._key !== b._key) return null
    if (!equal(a, b)) out.push({key: b._key, block: b})
  }
  return out
}

/**
 * Whether a value from outside the input replaces what the editor shows (`shown`: its
 * last save, else the value it opened with). Not when it is what the editor shows, nor
 * one of this input's own saves coming back (`mine`). A value going back to the one the
 * editor opened with (Discard changes, an undo) is from outside once the author has typed.
 */
export function isOutsideValue(incoming: unknown, shown: unknown, mine: unknown[]): boolean {
  return !equal(incoming, shown) && !mine.some((v) => equal(v, incoming))
}

const byKey = <T>(items: unknown): Map<string, T> => {
  const m = new Map<string, T>()
  for (const i of Array.isArray(items) ? items : []) if (isObj(i) && typeof i._key === 'string' && !m.has(i._key)) m.set(i._key, i as T)
  return m
}

// The block keys the editor owns. Anything else on a stored text block is carried over.
const MANAGED = ['_type', '_key', 'children', 'markDefs', 'style', 'listItem', 'level']

/**
 * `next` as the editor has it, with what it did not change taken from `stored`. A key
 * the stored object lacks stays absent when the editor only filled in its default
 * (`style: 'normal'`, `markDefs: []`, `marks: []`): `seen` is how the editor read `stored`.
 */
function keepAbsent(stored: Obj, seen: Obj | undefined, next: Obj, keys: string[]): Obj {
  const out: Obj = {}
  for (const k of keys) if (k in next && next[k] !== undefined && (k in stored || !seen || !equal(next[k], seen[k]))) out[k] = next[k]
  return out
}

function mergeChild(stored: Obj | undefined, seen: Obj | undefined, next: Obj): Obj {
  if (!stored) return next
  if (seen && equal(next, seen)) return stored
  // An inline object the author edited (S4c) changes only the keys edited.
  if (stored._type !== 'span' || next._type !== 'span') return stored._type === next._type ? editedObject(stored, seen, next) : stored
  const own = keepAbsent(stored, seen, next, ['_type', '_key', 'text', 'marks'])
  const rest = Object.fromEntries(Object.entries(stored).filter(([k]) => !['_type', '_key', 'text', 'marks'].includes(k)))
  return {...own, ...rest}
}

/**
 * An object the author edited: the stored one with only the keys the editor changed
 * (against its own reading, `seen`) set or removed. A key the editor never knew stays.
 */
export function editedObject(stored: Obj, seen: Obj | undefined, next: Obj): Obj {
  const base = seen ?? stored
  const out: Obj = {...stored}
  for (const k of new Set([...Object.keys(base), ...Object.keys(next)])) {
    if (k === '_key' || k === '_type' || equal(next[k], base[k])) continue
    if (next[k] === undefined) delete out[k]
    else out[k] = next[k]
  }
  return out
}

function mergeMarkDefs(stored: unknown, seen: unknown, next: unknown): unknown {
  if (equal(next, seen)) return stored
  const was = byKey<Obj>(stored)
  const read = byKey<Obj>(seen)
  // A markDef the author did not edit goes back as stored; an edited one changes only the keys edited.
  return Array.isArray(next)
    ? next.map((d) => {
        const key = isObj(d) && typeof d._key === 'string' ? d._key : undefined
        const s = key ? was.get(key) : undefined
        if (!s) return d
        const r = read.get(key!)
        return r && equal(d, r) ? s : editedObject(s, r, d as Obj)
      })
    : next
}

function mergeText(stored: PtBlock, seen: PtBlock | undefined, next: PtBlock): PtBlock {
  const own = keepAbsent(stored, seen, next, MANAGED.filter((k) => k !== 'children' && k !== 'markDefs'))
  const storedKids = byKey<Obj>(stored.children)
  const seenKids = byKey<Obj>(seen?.children)
  const children = (Array.isArray(next.children) ? next.children : []).map((c) => {
    const key = isObj(c) && typeof c._key === 'string' ? c._key : undefined
    return mergeChild(key ? storedKids.get(key) : undefined, key ? seenKids.get(key) : undefined, c as Obj)
  })
  const markDefs = 'markDefs' in stored || !equal(next.markDefs ?? [], seen?.markDefs ?? []) ? {markDefs: mergeMarkDefs(stored.markDefs, seen?.markDefs, next.markDefs)} : {}
  const rest = Object.fromEntries(Object.entries(stored).filter(([k]) => !MANAGED.includes(k)))
  return {...own, ...rest, children, ...markDefs} as unknown as PtBlock
}

/**
 * The value to save after an edit. `stored` is the field's value as read, `seen` the
 * editor's own reading of it before any edit (its normalised form), `next` the editor's
 * value now. A block, span, markDef, custom block or inline object the author did not touch
 * goes back byte for byte as stored; an edited one changes only the keys edited. A stored block the editor never loaded (not
 * in `seen`) is put back after the stored block before it, so nothing is lost unseen.
 */
export function mergeValue(stored: PtBlock[], seen: PtBlock[], next: PtBlock[]): PtBlock[] {
  const storedBy = byKey<PtBlock>(stored)
  const seenBy = byKey<PtBlock>(seen)
  const out: PtBlock[] = next.map((b) => {
    const key = typeof b._key === 'string' ? b._key : undefined
    const was = key ? storedBy.get(key) : undefined
    const read = key ? seenBy.get(key) : undefined
    if (!was) return b
    if (read && equal(b, read)) return was
    // A custom block the author edited (S4c) changes only the keys edited.
    if (was._type !== 'block' && b._type !== 'block') return was._type === b._type ? (editedObject(was, read, b) as PtBlock) : was
    if (!isText(was) || !isText(b)) return was
    return mergeText(was, read, b)
  })
  // Stored blocks the editor did not load: back after their stored neighbour.
  const missing = stored.filter((b) => typeof b._key === 'string' && !seenBy.has(b._key))
  for (const m of missing) {
    const at = stored.indexOf(m)
    let after = -1
    for (let i = at - 1; i >= 0 && after < 0; i--) after = out.findIndex((b) => b._key !== undefined && b._key === stored[i]._key)
    out.splice(after + 1, 0, m)
  }
  return out
}

// S4b (annotations) and S4c (custom blocks, inline objects). The fields a dialog shows come
// from, in order:
// 1. the field's declaration, `blocks.annotations`, `blocks.of` or `blocks.inline` entries
//    with `fields` (barkpark S1 and the twin's S5 add these for annotations);
// 2. for a custom block or inline object, the named object type (gyl's `blocks.of` names
//    quote, mediaModule and the rest, each a schema of kind object);
// 3. what the stored objects of that type hold (gyl today: linkAnnotation is declared
//    nowhere, so its url, internalLink, linkType and the rest are read off the value);
// 4. Sanity's default for `link`: one `href`.
// An annotation never takes a named object type: gyl's `link` object (a link field's type)
// is not the `link` annotation, which stores `href`.

/** The schemas this module reads: a type's name, its kind and its fields. */
export type SchemaLike = {name: string; kind?: string; fields?: Field[]}
export type PtKind = 'annotation' | 'block' | 'inline'
const KIND_KEY: Record<PtKind, string> = {annotation: 'annotations', block: 'of', inline: 'inline'}

/** The annotations the toolbar offers: the declared ones; none declared, those the value uses; none used, Sanity's `link`. */
export function offeredAnnotations(field: Pick<Field, 'blocks'>, value: unknown): Named[] {
  const b = isObj(field.blocks) ? field.blocks : {}
  if (Array.isArray(b.annotations)) return list(b.annotations, [])
  const used = observedVocabulary(value).annotations
  return used.length ? used : [{name: 'link'}]
}

/**
 * What Sanity's Markdown shortcuts turn typing into (its markdownConfig): `**` strong, `*`
 * em, a backtick code, `~~` strike-through, `#`..`######` headings, `>` a quote, `-` and
 * `1.` lists. Each only where the field declares it (what the toolbar offers); a shortcut
 * it lacks types its characters.
 */
export function markdownNames(field: Pick<Field, 'blocks'>) {
  const v = declaredVocabulary(field)
  const has = (names: Named[], name: string) => (names.some((n) => n.name === name) ? name : undefined)
  return {
    boldDecorator: has(v.decorators, 'strong'),
    codeDecorator: has(v.decorators, 'code'),
    italicDecorator: has(v.decorators, 'em'),
    strikeThroughDecorator: has(v.decorators, 'strike-through'),
    defaultStyle: has(v.styles, 'normal'),
    blockquoteStyle: has(v.styles, 'blockquote'),
    headingStyle: (level: number) => has(v.styles, `h${level}`),
    orderedList: has(v.lists, 'number'),
    unorderedList: has(v.lists, 'bullet'),
  }
}

/** A URL pasted over text links it (Sanity's paste-link) when the toolbar offers `link`. */
export const pastesLinks = (field: Pick<Field, 'blocks'>, value: unknown): boolean => offeredAnnotations(field, value).some((a) => a.name === 'link')

/** Every stored object of one kind and type: markDefs, custom blocks or inline objects named `name`. */
export function storedObjects(value: unknown, kind: PtKind, name: string): Obj[] {
  const out: Obj[] = []
  for (const b of Array.isArray(value) ? value : []) {
    if (!isObj(b)) continue
    if (kind === 'block' && b._type === name) out.push(b)
    if (!isText(b)) continue
    if (kind === 'annotation') for (const d of Array.isArray(b.markDefs) ? b.markDefs : []) if (isObj(d) && d._type === name) out.push(d)
    if (kind === 'inline') for (const c of Array.isArray(b.children) ? b.children : []) if (isObj(c) && c._type === name) out.push(c)
  }
  return out
}

const startCase = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase())

/**
 * The document types a reference field read off stored values may point to: those of a
 * declared reference field of the same name (gyl: `link.internalLink`), else every document type.
 */
export function refTargets(name: string, schemas: SchemaLike[]): {type: string}[] {
  const find = (fields: Field[] | undefined): Field | undefined => {
    for (const f of fields ?? []) {
      if (f.name === name && f.type === 'reference' && f.to?.length) return f
      const inner = find(f.fields)
      if (inner) return inner
    }
  }
  for (const s of schemas) {
    const f = find(s.fields)
    if (f) return f.to!
  }
  return schemas.filter((s) => s.kind !== 'object').map((s) => ({type: s.name}))
}

/** Fields read off stored objects, in the order their keys first show up. Arrays and plain objects are kept, not shown. */
export function inferFields(objects: Obj[], schemas: SchemaLike[]): Field[] {
  const out = new Map<string, Field>()
  for (const o of objects)
    for (const [k, v] of Object.entries(o)) {
      if (k.startsWith('_') || out.has(k) || v === undefined || v === null) continue
      const title = startCase(k)
      if (isObj(v) && typeof v._ref === 'string') out.set(k, {name: k, title, type: 'reference', to: refTargets(k, schemas)})
      else if (typeof v === 'boolean') out.set(k, {name: k, title, type: 'boolean'})
      else if (typeof v === 'number') out.set(k, {name: k, title, type: 'number'})
      else if (typeof v === 'string') out.set(k, {name: k, title, type: k === 'email' ? 'email' : k === 'href' || k === 'url' || /^(https?:|mailto:)/.test(v) ? 'url' : 'string'})
    }
  return [...out.values()]
}

/** The raw entry a field's `blocks` declares for one type, if any. */
function declaredEntry(field: Pick<Field, 'blocks'>, kind: PtKind, name: string): Obj | undefined {
  const b = isObj(field.blocks) ? field.blocks : {}
  const entries = b[KIND_KEY[kind]]
  return Array.isArray(entries) ? (entries.find((e) => isObj(e) && named(e)?.name === name) as Obj | undefined) : undefined
}

/** The fields a dialog for one annotation, custom block or inline object shows (see the order above). */
export function objectFields(field: Pick<Field, 'blocks'>, kind: PtKind, name: string, value: unknown, schemas: SchemaLike[]): Field[] {
  const entry = declaredEntry(field, kind, name)
  if (entry && Array.isArray(entry.fields) && entry.fields.length) return entry.fields as Field[]
  const named = kind !== 'annotation' ? schemas.find((s) => s.name === name && s.kind === 'object') : undefined
  if (named?.fields?.length) return named.fields
  const inferred = inferFields(storedObjects(value, kind, name), schemas)
  if (kind === 'annotation' && name === 'link' && !inferred.some((f) => f.name === 'href')) return [{name: 'href', title: 'URL', type: 'url'}, ...inferred]
  return inferred
}

/** The title a dialog, a button or a menu item shows for a type: declared, else the named type's, else its name. */
export function objectTitle(field: Pick<Field, 'blocks'>, kind: PtKind, name: string, schemas: (SchemaLike & {title?: string})[] = []): string {
  const t = declaredEntry(field, kind, name)?.title
  if (typeof t === 'string' && t) return t
  const named = kind !== 'annotation' ? schemas.find((s) => s.name === name && s.kind === 'object')?.title : undefined
  return named || startCase(name)
}

/** What Insert offers: the declared custom block and inline object types. An image or file block needs its own input: not yet. */
export function insertable(field: Pick<Field, 'blocks'>): {blocks: Named[]; inline: Named[]} {
  const d = declaredVocabulary(field)
  return {blocks: d.blockObjects.filter((b) => b.name !== 'file'), inline: d.inlineObjects}
}

/**
 * The props a dialog changed on an object, against the object as the editor holds it:
 * `set` for @portabletext/editor's block.set and child.set, `unset` for the keys emptied.
 */
export function objectChanges(node: Obj, shaped: Obj): {set: Obj; unset: string[]} {
  const set: Obj = {}
  const unset: string[] = []
  for (const k of new Set([...Object.keys(node), ...Object.keys(shaped)])) {
    if (k === '_key' || k === '_type' || equal(shaped[k], node[k])) continue
    if (shaped[k] === undefined) unset.push(k)
    else set[k] = shaped[k]
  }
  return {set, unset}
}

/** The editor's field list: the dialog's fields plus every key stored objects of that type hold. */
function editorFields(fields: Field[], stored: Obj[]): PtField[] {
  const out = new Map<string, PtField>()
  const ptType = (t: string): PtField['type'] => (t === 'boolean' ? 'boolean' : ['number', 'integer', 'float'].includes(t) ? 'number' : ['string', 'text', 'url', 'email', 'select', 'date', 'datetime', 'time', 'markdown'].includes(t) ? 'string' : 'object')
  for (const f of fields) out.set(f.name, {name: f.name, type: ptType(f.type)})
  for (const o of stored)
    for (const [k, v] of Object.entries(o)) if (!k.startsWith('_') && !out.has(k)) out.set(k, {name: k, type: typeof v === 'boolean' ? 'boolean' : typeof v === 'number' ? 'number' : typeof v === 'string' ? 'string' : 'object'})
  return [...out.values()]
}

/**
 * What a dialog's value stores, Sanity-shaped as the rest of the Portable Text value is:
 * the reference input gives a bare id, a markDef holds `{_type: 'reference', _ref}`. A
 * reference whose id did not change keeps its stored object (gyl has some with
 * `_type: 'internalLink'`); an emptied field is left out.
 */
export function storedShape(fields: Field[], value: Obj, before: Obj = {}): Obj {
  const out: Obj = {}
  for (const [k, v] of Object.entries(value)) {
    const was = before[k]
    // Untouched: as stored, an empty string or null included.
    if (k in before && equal(v, was)) {
      out[k] = was
      continue
    }
    if (v === undefined || v === null || v === '') continue
    const f = fields.find((x) => x.name === k)
    if (f?.type === 'reference' && typeof v === 'string') out[k] = refId(was) === v ? was : {...(isObj(was) ? was : {_type: 'reference'}), _ref: v}
    else if (f?.type === 'composite' && f.fields && isObj(v)) out[k] = storedShape(f.fields, v, isObj(was) ? was : {})
    else out[k] = v
  }
  return out
}

/** A new key, as the editor and Sanity make them: 12 hex digits. */
export function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}
