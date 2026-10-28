import type {Field} from './data'

// S4a (task-7f77f41c95cc6d9f): Portable Text in a richText field, edited with
// @portabletext/editor. Two jobs live here, apart from React so a unit test can run them:
// - the editor's schema, from the field's `blocks` declaration plus whatever the stored
//   value already holds, so the editor never drops a type it was not told about;
// - the value to save: blocks and spans the author did not touch go back exactly as
//   they were stored, and only the edited ones take the editor's version.

type Obj = Record<string, unknown>
export type PtBlock = Obj & {_type: string; _key?: string}
type Named = {name: string; title?: string}
export type PtVocabulary = {
  styles: Named[]
  lists: Named[]
  decorators: Named[]
  annotations: Named[]
  blockObjects: Named[]
  inlineObjects: Named[]
}
/** A schema in @portabletext/editor's SchemaDefinition shape. */
export type PtSchema = PtVocabulary & {block: {name: 'block'}}

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
export function editorSchema(field: Pick<Field, 'blocks'>, value: unknown): PtSchema {
  const d = declaredVocabulary(field)
  const o = observedVocabulary(value)
  // `normal` is always a style: a new paragraph takes it.
  const styles = union(d.styles.some((s) => s.name === 'normal') ? d.styles : [{name: 'normal'}, ...d.styles], o.styles)
  return {
    block: {name: 'block'},
    styles,
    lists: union(d.lists, o.lists),
    decorators: union(d.decorators, o.decorators),
    annotations: union(d.annotations, o.annotations),
    blockObjects: union(d.blockObjects, o.blockObjects),
    inlineObjects: union(d.inlineObjects, o.inlineObjects),
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
  // An inline object can't be edited here (S4c): it goes back as it was stored.
  if (stored._type !== 'span' || next._type !== 'span') return stored
  const own = keepAbsent(stored, seen, next, ['_type', '_key', 'text', 'marks'])
  const rest = Object.fromEntries(Object.entries(stored).filter(([k]) => !['_type', '_key', 'text', 'marks'].includes(k)))
  return {...own, ...rest}
}

function mergeMarkDefs(stored: unknown, seen: unknown, next: unknown): unknown {
  if (equal(next, seen)) return stored
  const was = byKey<Obj>(stored)
  // A markDef can't be edited here (S4b): one the block still holds goes back as stored.
  return Array.isArray(next) ? next.map((d) => (isObj(d) && typeof d._key === 'string' && was.get(d._key)) || d) : next
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
 * value now. A block or span the author did not touch goes back byte for byte as stored;
 * custom blocks always do (S4c edits them). A stored block the editor never loaded (not
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
