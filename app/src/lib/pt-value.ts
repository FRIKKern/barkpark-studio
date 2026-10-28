import type {Field} from './data'
import {refId} from './refs.ts'

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
    blockObjects: union(d.blockObjects, o.blockObjects).map((b) => ({...b, fields: editorFields(objectFields(field, 'block', b.name, value, schemas), storedObjects(value, 'block', b.name))})),
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
  return {blocks: d.blockObjects.filter((b) => b.name !== 'image' && b.name !== 'file'), inline: d.inlineObjects}
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
