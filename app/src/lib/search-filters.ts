import type {Field, RefFilter, Schema} from './data'

// J38, Sanity's search filters (sanity 6.17 `defineSearchFilter` + operators):
// every filterable field of the types in play, each with Sanity's operators and
// its chip wording ("Rating ≥ 3", "Edited at is in the last 7 days"). Filters run
// in Barkpark's query (filter[field][op]=value; barkpark#22106 added does not contain,
// array includes and counts; `_references` for the pinned "Contains document, image or
// file"; `nbetween` for a date-time "is not", which is "not on that day").

export type Kind = 'string' | 'select' | 'number' | 'boolean' | 'date' | 'datetime' | 'reference' | 'array' | 'arrayRef' | 'refs' | 'presence'
export type FilterField = {
  /** path + kind: one entry for a field that several types share. */
  key: string
  path: string
  title: string
  /** The enclosing object's title, for a nested field ("Seo" › "Meta title"). */
  parent?: string
  kind: Kind
  /** The types that have this field (empty for Edited at / Created at: every type). */
  types: string[]
  options?: {value: string; title: string}[]
  refTypes?: string[]
  builtin?: boolean
}
export type OpName =
  | 'contains' | 'notContains' | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'range' | 'last' | 'after' | 'before' | 'defined' | 'notDefined'
  | 'refDocument' | 'refImage' | 'refFile'
  | 'includes' | 'notIncludes' | 'countEq' | 'countNeq' | 'countGt' | 'countGte' | 'countLt' | 'countLte' | 'countRange'
export type Unit = 'days' | 'months' | 'years'
export type SearchFilter = {id: string; field: string; op: OpName; value?: string; to?: string; unit?: Unit; label?: string}

/** The Studio's translate function (lib/i18n), passed in by the render; English by default. */
export type Translate = (en: string, vars?: Record<string, string | number>) => string
export const english: Translate = (en, vars) => (vars ? en.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all)) : en)

/** The operator menu ("name") and the chip ("description") wording, Sanity's (English; translated where shown). */
export const OPS: Record<OpName, {name: string; desc: string; symbol?: string}> = {
  contains: {name: 'contains', desc: 'contains'},
  notContains: {name: 'does not contain', desc: 'does not contain'},
  eq: {name: 'is', desc: 'is'},
  neq: {name: 'is not', desc: 'is not'},
  gt: {name: 'greater than', desc: '>', symbol: '>'},
  gte: {name: 'greater than or equal to', desc: '≥', symbol: '≥'},
  lt: {name: 'less than', desc: '<', symbol: '<'},
  lte: {name: 'less than or equal to', desc: '≤', symbol: '≤'},
  range: {name: 'is between', desc: 'is between'},
  last: {name: 'last', desc: 'is in the last'},
  after: {name: 'after', desc: 'is after'},
  before: {name: 'before', desc: 'is before'},
  defined: {name: 'not empty', desc: 'is'},
  notDefined: {name: 'empty', desc: 'is'},
  refDocument: {name: 'document', desc: '→'},
  refImage: {name: 'image', desc: '→'},
  refFile: {name: 'file', desc: '→'},
  includes: {name: 'includes', desc: 'includes'},
  notIncludes: {name: 'does not include', desc: 'does not include'},
  countEq: {name: 'quantity is', desc: 'has'},
  countNeq: {name: 'quantity is not', desc: 'does not have'},
  countGt: {name: 'quantity greater than', desc: 'has >', symbol: '>'},
  countGte: {name: 'quantity greater than or equal to', desc: 'has ≥', symbol: '≥'},
  countLt: {name: 'quantity less than', desc: 'has <', symbol: '<'},
  countLte: {name: 'quantity less than or equal to', desc: 'has ≤', symbol: '≤'},
  countRange: {name: 'quantity is between', desc: 'has between'},
}
const COUNT = new Set<OpName>(['countEq', 'countNeq', 'countGt', 'countGte', 'countLt', 'countLte', 'countRange'])
export const isCount = (op: OpName) => COUNT.has(op)

// Groups split by a divider in the operator menu, in Sanity's order.
const DATE: OpName[][] = [['last'], ['range', 'after', 'before'], ['eq', 'neq']]
const COUNTS: OpName[][] = [['countEq', 'countNeq'], ['countGt', 'countGte', 'countLt', 'countLte'], ['countRange']]
const OPERATORS: Record<Kind, OpName[][]> = {
  string: [['contains', 'notContains'], ['eq', 'neq'], ['defined', 'notDefined']],
  select: [['eq', 'neq'], ['contains', 'notContains'], ['defined', 'notDefined']],
  number: [['eq', 'neq'], ['gt', 'gte', 'lt', 'lte'], ['range'], ['defined', 'notDefined']],
  boolean: [['eq'], ['notDefined']],
  date: [['last'], ['range', 'after', 'before'], ['eq', 'neq'], ['defined', 'notDefined']],
  datetime: [...DATE, ['defined', 'notDefined']],
  reference: [['eq', 'neq'], ['defined', 'notDefined']],
  // Sanity's "array" and "arrayReferences" filters.
  array: [['defined', 'notDefined'], ...COUNTS],
  arrayRef: [['includes', 'notIncludes'], ['defined', 'notDefined'], ...COUNTS],
  // Sanity's pinned "references" filter.
  refs: [['refDocument', 'refImage', 'refFile']],
  presence: [['defined', 'notDefined']],
}
export const operatorsFor = (f: FilterField): OpName[][] => (f.builtin && f.kind === 'datetime' ? DATE : OPERATORS[f.kind])

const KIND: Record<string, Kind> = {
  string: 'string', text: 'string', slug: 'string', email: 'string', url: 'string', markdown: 'string', color: 'string', codelist: 'string',
  select: 'select', number: 'number', integer: 'number', float: 'number', boolean: 'boolean', date: 'date', datetime: 'datetime', reference: 'reference',
  image: 'presence', file: 'presence', arrayOf: 'array', array: 'array', tags: 'array', richText: 'presence', localizedText: 'presence',
}
const startCase = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
const titleOf = (f: Field) => f.title ?? startCase(f.name)

export const BUILTINS: FilterField[] = [
  {key: '_updatedAt', path: '_updatedAt', title: 'Edited at', kind: 'datetime', types: [], builtin: true},
  {key: '_createdAt', path: '_createdAt', title: 'Created at', kind: 'datetime', types: [], builtin: true},
  {key: '_references', path: '_references', title: 'Contains document, image or file', kind: 'refs', types: [], builtin: true},
]

function selectOptions(f: Field) {
  const raw = (Array.isArray(f.options) ? f.options : (f.options as {list?: unknown[]} | undefined)?.list) ?? []
  return raw.map((o) => (typeof o === 'object' && o ? {value: String((o as {value: unknown}).value), title: String((o as {title?: unknown}).title ?? (o as {value: unknown}).value)} : {value: String(o), title: String(o)}))
}

/** One schema's filterable fields, nested object fields included (Sanity: "Seo" › "Meta title"). */
export function schemaFields(s: Schema): FilterField[] {
  const out: FilterField[] = []
  const walk = (fields: Field[], prefix: string, parent?: string) => {
    for (const f of fields) {
      if ((f.type === 'composite' || f.type === 'object') && f.fields) {
        walk(f.fields, `${prefix}${f.name}.`, titleOf(f))
        continue
      }
      const base = KIND[f.type]
      if (!base) continue
      const of = f.of
      const kind: Kind = base === 'array' && of?.type === 'reference' ? 'arrayRef' : base
      const path = prefix + f.name
      out.push({
        key: `${path}:${kind}`, path, title: titleOf(f), parent, kind, types: [s.name],
        ...(kind === 'select' && {options: selectOptions(f)}),
        ...(kind === 'reference' && {refTypes: f.to?.map((t) => t.type) ?? (f.refType ? [f.refType] : [])}),
        ...(kind === 'arrayRef' && {refTypes: of?.to?.map((t) => t.type) ?? (of?.refType ? [of.refType] : [])}),
      })
    }
  }
  walk(s.fields, '')
  return out
}

/** A field's title as shown: the document dates are ours to translate, schema titles are the author's. */
export const fieldTitle = (f: FilterField, t: Translate = english) => (f.builtin ? t(f.title) : f.title)

const byTitle = (a: FilterField, b: FilterField) => a.title.localeCompare(b.title) || (a.parent ?? '').localeCompare(b.parent ?? '') || a.path.localeCompare(b.path)

/** Every field of these schemas once, the types that have it merged (the "All fields" list). */
export function allFields(schemas: Schema[]): FilterField[] {
  const seen = new Map<string, FilterField>()
  for (const s of schemas)
    for (const f of schemaFields(s)) {
      const had = seen.get(f.key)
      seen.set(f.key, had ? {...had, types: [...had.types, s.name], refTypes: [...new Set([...(had.refTypes ?? []), ...(f.refTypes ?? [])])]} : f)
    }
  return [...seen.values()].sort(byTitle)
}

export type Section = {title?: string; fields: FilterField[]}

/**
 * "Add filter": the document dates, then with all types one "All fields" list;
 * with types picked, "Shared fields" (in two or more of them) and one list per type.
 * A typed filter keeps only titles that match.
 */
export function filterMenu(schemas: Schema[], types: string[], find: string, t: Translate = english): Section[] {
  const q = find.trim().toLowerCase()
  const keep = (fs: FilterField[]) => (q ? fs.filter((f) => fieldTitle(f, t).toLowerCase().includes(q)) : fs)
  const picked = schemas.filter((s) => types.includes(s.name)).sort((a, b) => a.title.localeCompare(b.title))
  const sections: Section[] = [{fields: BUILTINS}]
  if (!picked.length || q) sections.push({title: t('All fields'), fields: allFields(picked.length ? picked : schemas)})
  else {
    if (picked.length > 1) sections.push({title: t('Shared fields'), fields: allFields(picked).filter((f) => f.types.length > 1)})
    for (const s of picked) sections.push({title: s.title, fields: schemaFields(s).sort(byTitle)})
  }
  return sections.map((s) => ({...s, fields: keep(s.fields)})).filter((s) => s.fields.length)
}

/** A new filter on `field`: its first operator; a date starts at "in the last 7 days", as Sanity's. */
export const newFilter = (field: FilterField, id: string): SearchFilter => {
  const op = operatorsFor(field)[0]![0]!
  return {id, field: field.key, op, ...(op === 'last' && {value: '7', unit: 'days' as const})}
}

export const isComplete = (f: SearchFilter) =>
  f.op === 'defined' || f.op === 'notDefined' || (f.op === 'range' || f.op === 'countRange' ? !!f.value && !!f.to : !!f.value)

const fmtDate = (v: string, kind: Kind, tag: string) => {
  const d = new Date(kind === 'date' ? `${v}T00:00` : v)
  if (Number.isNaN(d.getTime())) return v
  return kind === 'date'
    ? d.toLocaleDateString(tag, {month: 'short', day: 'numeric', year: 'numeric'})
    : d.toLocaleString(tag, {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'})
}

// "7 days", "1 month": the unit word with its count, one message each so it can be translated.
const UNIT: Record<Unit, [string, string]> = {days: ['{n} day', '{n} days'], months: ['{n} month', '{n} months'], years: ['{n} year', '{n} years']}

/**
 * The chip: "Field" until it can apply, then "Field operator value". `t` and `tag`
 * (an Intl locale for dates) come from the render; English by default.
 */
export function filterLabel(f: SearchFilter, field: FilterField | undefined, t: Translate = english, tag = 'en-US'): {field: string; op?: string; value?: string} {
  const name = field ? fieldTitle(field, t) : f.field.split(':')[0]!
  if (!field || !isComplete(f)) return {field: name}
  const v = (s: string) =>
    field.kind === 'date' || field.kind === 'datetime' ? fmtDate(s, f.op === 'eq' || f.op === 'neq' ? 'date' : field.kind, tag)
      : field.kind === 'select' ? field.options?.find((o) => o.value === s)?.title ?? s
        : field.kind === 'boolean' ? (s === 'true' ? t('True') : t('False'))
          : field.kind === 'reference' || field.kind === 'arrayRef' || field.kind === 'refs' ? f.label ?? s
            : s
  const value =
    f.op === 'defined' ? t('not empty')
      : f.op === 'notDefined' ? t('empty')
        : f.op === 'last' ? t(UNIT[f.unit ?? 'days'][Number(f.value) === 1 ? 0 : 1], {n: f.value!})
          : f.op === 'countRange' ? t('{from} → {to} items', {from: f.value!, to: f.to!})
            : isCount(f.op) ? t(Number(f.value) === 1 ? '{n} item' : '{n} items', {n: f.value!})
              : f.op === 'range' ? `${v(f.value!)} → ${v(f.to!)}`
                : v(f.value!)
  return {field: name, op: t(OPS[f.op].desc), value}
}
export const labelText = (l: ReturnType<typeof filterLabel>) => [l.field, l.op, l.value].filter(Boolean).join(' ')

const iso = (d: Date) => d.toISOString().replace('.000Z', 'Z')
/** A local date-time from the picker ("2026-10-08T09:00") as the stored UTC form. */
const instant = (v: string) => iso(new Date(v))
function ago(n: number, unit: Unit, now: Date) {
  const d = new Date(now)
  if (unit === 'days') d.setDate(d.getDate() - n)
  else if (unit === 'months') d.setMonth(d.getMonth() - n)
  else d.setFullYear(d.getFullYear() - n)
  return d
}

/**
 * The Barkpark filter for one type, or null when a filter names a field this type
 * lacks (Sanity narrows the types to those holding every filtered field).
 */
// "In the last N days" counts from the current minute, so the query (and its cache key) holds still between renders.
const thisMinute = () => new Date(Math.floor(Date.now() / 60_000) * 60_000)
export function toRefFilter(schema: Schema, filters: SearchFilter[], fields: Map<string, FilterField>, now = thisMinute()): RefFilter | null {
  const out: RefFilter = {}
  const own = new Set(schemaFields(schema).map((f) => f.key))
  for (const f of filters) {
    const field = fields.get(f.field)
    if (!field) continue
    if (!field.builtin && !own.has(f.field)) return null
    if (!isComplete(f)) continue
    const set = (op: string, value: string) => (out[field.path] = {...out[field.path], [op]: value})
    const date = field.kind === 'date'
    const at = (v: string) => (date ? v : instant(v))
    switch (f.op) {
      case 'defined': set('is', 'notnull'); break
      case 'notDefined': set('is', 'null'); break
      case 'last': {
        const since = ago(Number(f.value), f.unit ?? 'days', now)
        set('gte', date ? since.toISOString().slice(0, 10) : iso(since))
        break
      }
      case 'after': set('gt', at(f.value!)); break
      case 'before': set('lt', at(f.value!)); break
      case 'range': set('gte', field.kind === 'number' ? f.value! : at(f.value!)); set('lte', field.kind === 'number' ? f.to! : at(f.to!)); break
      case 'countRange': set('countGte', f.value!); set('countLte', f.to!); break
      case 'refDocument': case 'refImage': case 'refFile': set('', f.value!); break
      case 'includes': set('has', f.value!); break
      case 'notIncludes': set('nhas', f.value!); break
      case 'eq':
      case 'neq':
        if (field.kind === 'datetime') {
          // A date-time "is" a day: from its midnight to the next; "is not", outside it.
          const day = new Date(`${f.value!.slice(0, 10)}T00:00`)
          const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
          if (f.op === 'eq') (set('gte', iso(day)), set('lt', iso(next)))
          else set('nbetween', `${iso(day)},${new Date(next.getTime() - 1).toISOString()}`)
        } else set(f.op, f.value!)
        break
      default: set(f.op, f.value!)
    }
  }
  return out
}
