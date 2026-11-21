import type {Doc, Field, Schema} from './data'
import {getPath, setPath} from './paths.ts'
import {refId} from './refs.ts'
import type {Start} from './today-start.ts'

// Sanity's incoming references input (`defineIncomingReferenceDecoration`, 6.17): inside a
// document's form, the documents that reference it, by type, with "Add item" creating one
// that already points here. Barkpark refuses a field type it does not know (422), so the
// declaration is not a field: it sits beside `desk.views` in the type's schema
// (`desk.incoming`, kept as given) or in the studio config (`form.incomingReferences`).
// It holds no value: nothing here is a field of the document, so nothing of it is ever
// written to, diffed, validated, copied, searched or inspected as the document's data.
// Pure (no React, no server): node's tests load it.

/** Docs of `type` whose `by` field (a reference, or an array of them) points at the open doc. B09's desk views read the same. */
export type Related = {type: string; by: string; orderings?: {field: string; direction: 'asc' | 'desc'}[]}
/** One kind of referrer in a declaration; `title` names its list when the declaration has several. */
export type IncomingType = Related & {title?: string}
/**
 * One list in the form. `creationAllowed` (Sanity's): false hides "Add item"; a list of
 * template ids offers only those.
 */
export type IncomingDecl = {name: string; title: string; description?: string; group?: string; types: IncomingType[]; creationAllowed: boolean | string[]}

/** A declaration as written (`desk.incoming` in a schema, `form.incomingReferences[type]` in the studio config). */
export type IncomingInput = {
  name: string
  title?: string
  description?: string
  /** The field group (tab) it shows on; without one, under all fields only. */
  group?: string
  /** `{type, by}`, or `{view}`: the relation one of the type's `desk.views` already declares. */
  types: (({type: string; by: string; orderings?: Related['orderings']} | {view: string}) & {title?: string})[]
  creationAllowed?: boolean | string[]
}

/** The most rows one list reads, as B09's views (Barkpark's own view bar reads 200). */
export const RELATED_MAX = 200

const PATH = /^[A-Za-z_][\w.]*$/
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
/** Sanity's fallback title for a decoration: its name, start-cased. */
const startCase = (s: string) => s.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase())

function orderingsOf(raw: unknown): Related['orderings'] {
  if (!Array.isArray(raw)) return undefined
  const out = raw.flatMap((o) => (isObj(o) && typeof o.field === 'string' && PATH.test(o.field) ? [{field: o.field, direction: o.direction === 'desc' ? ('desc' as const) : ('asc' as const)}] : []))
  return out.length ? out : undefined
}

/**
 * The declarations in `raw` (a schema's `desk.incoming`, or the config's list for a type).
 * A type entry is `{type, by}` or `{view: '<a desk.views id>'}` (the same relation as that
 * tab). What cannot be read (no name, no type that resolves) is left out, never guessed;
 * a second declaration with a name already taken is dropped.
 */
export function parseIncoming(raw: unknown, views: (Related & {id: string})[] = []): IncomingDecl[] {
  if (!Array.isArray(raw)) return []
  const out: IncomingDecl[] = []
  for (const d of raw) {
    const name = isObj(d) ? text(d.name) : undefined
    if (!isObj(d) || !name || out.some((x) => x.name === name)) continue
    const types = (Array.isArray(d.types) ? d.types : []).flatMap((t): IncomingType[] => {
      if (!isObj(t)) return []
      const view = typeof t.view === 'string' ? views.find((v) => v.id === t.view) : undefined
      const type = text(t.type) ?? view?.type
      const by = text(t.by) ?? view?.by
      if (!type || !by || !PATH.test(by)) return []
      const orderings = orderingsOf(t.orderings) ?? view?.orderings
      return [{type, by, ...(orderings && {orderings}), ...(text(t.title) && {title: text(t.title)})}]
    })
    if (!types.length) continue
    const allowed = d.creationAllowed
    out.push({
      name,
      title: text(d.title) ?? startCase(name),
      ...(text(d.description) && {description: text(d.description)}),
      ...(text(d.group) && {group: text(d.group)}),
      types,
      creationAllowed: Array.isArray(allowed) ? allowed.filter((x): x is string => typeof x === 'string') : allowed !== false,
    })
  }
  return out
}

/** A type's lists: its schema's own first, then the config's whose name the schema has not taken. */
export function incomingFor(schema: Pick<Schema, 'incoming' | 'views'> | undefined, config: unknown): IncomingDecl[] {
  const own = schema?.incoming ?? []
  return [...own, ...parseIncoming(config, schema?.views).filter((c) => !own.some((o) => o.name === c.name))]
}

/** The lists the form shows under `group` ('' = all fields): one with a group shows on its tab and under all fields. */
export const incomingIn = (decls: IncomingDecl[], group: string) => decls.filter((d) => !group || d.group === group)

/** `by` as a path in the document: Barkpark's filters also take `content.author` for `author`. */
export const fieldPathOf = (by: string) => by.replace(/^content\./, '')

/** Does `doc` point at `id` through `by`: the reference itself, or one item of an array of them? */
export function pointsVia(doc: unknown, by: string, id: string): boolean {
  const v = getPath(doc, fieldPathOf(by))
  return Array.isArray(v) ? v.some((item) => refId(item) === id) : refId(v) === id
}

const DEFAULT_ORDER: NonNullable<Related['orderings']> = [{field: '_updatedAt', direction: 'desc'}]
const orderOf = (r: Related) => (r.orderings?.length ? r.orderings : DEFAULT_ORDER)

/**
 * The read: Barkpark's `in` matches a field holding the id itself (a reference) and an
 * array holding it as an item or as an item's `_ref` (an array of references), so one
 * filter serves both. Drafts over published as the lists read, or the published versions
 * alone; last edited first unless the declaration orders it.
 */
export function relatedPath(dataset: string, r: Related, id: string, published = false): string {
  const order = orderOf(r).map((o) => `${o.field}:${o.direction}`).join(',')
  return `/v1/data/query/${dataset}/${encodeURIComponent(r.type)}?perspective=${published ? 'published' : 'drafts'}&limit=${RELATED_MAX}&filter[${encodeURIComponent(r.by)}][in]=${encodeURIComponent(id)}&order=${order}`
}

/**
 * Barkpark's drafts perspective answers a filter with the PUBLISHED version of a document
 * whose draft no longer matches it (a post published under this author, its draft now naming
 * another). That row is not the document as editors see it: it is asked about (`draftsPath`)
 * and dropped (`unshadowed`), so the list, and whatever opens from it, is the draft's truth.
 */
export const shadowable = (rows: Doc[]) => rows.filter((d) => !d._draft).map((d) => d._publishedId)
/** The reads that say which of `ids` have a draft: `_id in` matches a draft by its `drafts.` id only. */
export function draftsPaths(dataset: string, type: string, ids: string[], per = 50): string[] {
  const out: string[] = []
  for (let i = 0; i < ids.length; i += per)
    out.push(`/v1/data/query/${dataset}/${encodeURIComponent(type)}?perspective=drafts&limit=${per}&filter[_id][in]=${ids.slice(i, i + per).map((id) => encodeURIComponent(`drafts.${id}`)).join(',')}`)
  return out
}
/** The rows without the published versions that a draft (one of `drafted`, published ids) stands in front of. */
export const unshadowed = (rows: Doc[], drafted: Iterable<string>) => {
  const has = new Set(drafted)
  return has.size ? rows.filter((d) => d._draft || !has.has(d._publishedId)) : rows
}

/**
 * Does `a` come before `b` in the list's order? A value that is not there sorts as the
 * greatest, as Barkpark's order does (last ascending, first descending): so a doc not saved
 * yet, which has no time, is the newest.
 */
function before(a: Doc, b: Doc, r: Related): boolean {
  for (const {field, direction} of orderOf(r)) {
    const [x, y] = [getPath(a, field), getPath(b, field)]
    const [nx, ny] = [x === undefined || x === null || (x === '' && field.startsWith('_')), y === undefined || y === null || (y === '' && field.startsWith('_'))]
    const c = nx || ny ? Number(nx) - Number(ny) : typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, {numeric: true, sensitivity: 'base'})
    if (c) return direction === 'desc' ? c > 0 : c < 0
  }
  return false
}

/**
 * Live: the rows after `doc` changed (here, or in a frame from the server). A doc of the
 * type that now points here joins at its place in the order; one already listed keeps its
 * place (a row does not jump while its title is typed) and takes the new values; one that
 * points away leaves. Any other doc changes nothing (the same array comes back).
 */
export function foldRelated(rows: Doc[], doc: Doc, r: Related, id: string): Doc[] {
  if (doc._type !== r.type || doc._publishedId === id) return rows
  const at = rows.findIndex((d) => d._publishedId === doc._publishedId)
  if (!pointsVia(doc, r.by, id)) return at < 0 ? rows : rows.filter((_, i) => i !== at)
  if (at >= 0) return rows[at] === doc ? rows : rows.map((d, i) => (i === at ? doc : d))
  const place = rows.findIndex((d) => before(doc, d, r))
  return place < 0 ? [...rows, doc] : [...rows.slice(0, place), doc, ...rows.slice(place)]
}

/** Live: the rows without the doc `publishedId` (it was deleted). */
export const dropRelated = (rows: Doc[], publishedId: string) => (rows.some((d) => d._publishedId === publishedId) ? rows.filter((d) => d._publishedId !== publishedId) : rows)

/**
 * A row is shown while its document, as this browser holds it, points here. One that does
 * not exist on the server yet (no `_rev`: "Add item" a moment ago, or a create that failed)
 * shows only while its own pane is open: a row never leads to "not found".
 */
export function shownRelated(rows: Doc[], r: Related, id: string, held: (publishedId: string) => Doc | null | undefined, open: (publishedId: string) => boolean): Doc[] {
  const seen = new Set<string>()
  return rows.flatMap((row) => {
    if (seen.has(row._publishedId)) return []
    seen.add(row._publishedId)
    const doc = held(row._publishedId)
    if (doc === null) return []
    const now = doc ?? row
    return pointsVia(now, r.by, id) && (!!now._rev || open(now._publishedId)) ? [now] : []
  })
}

/** The field `path` names in `fields`, through composites. */
function fieldAt(fields: Field[] | undefined, path: string): Field | undefined {
  const [head, ...rest] = path.split('.')
  const f = fields?.find((x) => x.name === head)
  return !f || !rest.length ? f : fieldAt(f.fields, rest.join('.'))
}

/** What kind of field `by` is on the referring type: a reference, an array of them, or neither (a declaration to fix). */
export function referenceKind(schema: Pick<Schema, 'fields'> | undefined, by: string): 'reference' | 'array' | null {
  const f = fieldAt(schema?.fields, fieldPathOf(by))
  if (f?.type === 'reference') return 'reference'
  return f?.type === 'arrayOf' && f.of?.type === 'reference' ? 'array' : null
}

/**
 * What "Add item" puts on the new document, over `initial` (its template's values): the
 * reference to `id` in `by`. A reference field holds the id (whatever the template had
 * there); an array of references keeps the template's items and gets one keyed item more,
 * unless one already points here. Returned as whole top-level fields, as a create takes
 * them; null when `by` is no reference field of the type.
 */
export function referencePreset(schema: Pick<Schema, 'fields'> | undefined, by: string, id: string, initial: Record<string, unknown> = {}, newKey: () => string = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12)): Record<string, unknown> | null {
  const kind = referenceKind(schema, by)
  if (!kind) return null
  const path = fieldPathOf(by)
  const top = path.split('.')[0]!
  let value: unknown = id
  if (kind === 'array') {
    const had = getPath(initial, path)
    const items = Array.isArray(had) ? had : []
    value = items.some((item) => refId(item) === id) ? items : [...items, {_key: newKey(), _type: 'reference', _ref: id}]
  }
  return {[top]: setPath({[top]: initial[top]}, path, value)[top]}
}

/**
 * "Add item"'s create, from the chosen way to start the type: the reference preset over the
 * template's values, all as the Studio's own (`local`), so a `$today` beside the reference in
 * its top field is resolved too, never stored as text. The type's own start (`choice.id` is the
 * type) adds only the preset; Barkpark fills the rest from the same initial values. Null when
 * `by` is no reference field of the type.
 */
export function addItemStart(schema: Pick<Schema, 'fields'> | undefined, by: string, id: string, type: string, choice: {id: string; value: Record<string, unknown>}): Start | null {
  const preset = referencePreset(schema, by, id, choice.value)
  return preset && {local: {...(choice.id === type ? {} : choice.value), ...preset}}
}

/** "Add item"'s choices: every way to start the type, or only the templates `creationAllowed` names; none when it is false. */
export function creationChoices<C extends {id: string}>(choices: C[], allowed: boolean | string[]): C[] {
  if (allowed === false) return []
  return Array.isArray(allowed) ? choices.filter((c) => allowed.includes(c.id)) : choices
}
