import type {Doc, Field, Schema} from './data'
import type {Level, Problem} from './validation'
import {holds} from './conditions.ts'
import {describeField} from './custom-rules.ts'
import {itemPath} from './refs.ts'

// A schema's cross-field rules (Barkpark's `cross_validations`, api/lib/barkpark/content/
// cross_validator.ex): `{name, title, rule, level, fields}`, where `rule` is a leaf
// `{field, operator, value?}` or `all` / `any` of them, nested. Barkpark checks them at every
// write; the studio shows them as you type, under each field the rule names.
// `each` (+ `type`) runs a rule once per list item, and its problem lands on that item.

export type CrossRule = {name?: string; title?: string; rule?: unknown; level?: string; fields?: unknown; each?: unknown; type?: unknown}

// The server's operators (cross_validator.ex @operators). A rule using any other is
// unevaluable there and never a finding, so it is skipped here too, quietly.
const OPERATORS = new Set(['eq', 'neq', 'in', 'empty', 'non_empty', 'starts_with', 'count_eq', 'count_neq', 'count_gt', 'count_lt', 'gt', 'gte', 'lt', 'lte'])

type Body = Record<string, unknown>

/** The served rules as the studio's schema keeps them: none (no key) when the type has none, so it reads as before. */
export const crossRulesOf = (rules: unknown): {crossValidations?: CrossRule[]} =>
  Array.isArray(rules) && rules.length ? {crossValidations: rules as CrossRule[]} : {}
const isMap = (v: unknown): v is Body => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Whether the server can evaluate this body (cross_validator.ex `partition`): known operators on
 * declared fields, a `valueField` naming one too. `names` null: an item rule's leaf, which names
 * the item's fields (not checked there either).
 */
function evaluable(body: unknown, names: Set<string> | null, item = false): boolean {
  if (!isMap(body) || !Object.keys(body).length) return false
  // Elixir's `all || any || one`: false and null fall through.
  const truthy = (v: unknown) => (v === false || v === null || v === undefined ? undefined : v)
  const preds = truthy(body.all) ?? truthy(body.any) ?? truthy(body.one)
  if (preds !== undefined) return Array.isArray(preds) && preds.length > 0 && preds.every((p) => evaluable(p, names, item))
  const {field, operator, valueField} = body
  // In an item rule only a "document" leaf names the document's fields.
  const known = item && body.scope !== 'document' ? null : names
  const declared = (f: string) => !known || known.has(f.split('.')[0]!)
  const other = valueField === undefined || valueField === null || (typeof valueField === 'string' && valueField !== '' && declared(valueField))
  return typeof field === 'string' && field !== '' && typeof operator === 'string' && OPERATORS.has(operator) && declared(field) && other
}

/** The rule's `each` / `type` as the server reads them (cross_validator.ex unevaluable_reason): evaluable, and whether it is an item rule. */
function shapeOk(r: CrossRule, names: Set<string>): boolean {
  const {each, type} = r
  const has = (v: unknown) => v !== undefined && v !== null
  // A path that can never find items ("meny.", "meny.0", "meny..under") is malformed there too.
  if (has(each) && (typeof each !== 'string' || each.split('.').some((s) => s === '' || /^\d+$/.test(s)) || !names.has(each.split('.')[0]!))) return false
  if (has(type) && (!has(each) || typeof type !== 'string' || type === '')) return false
  return evaluable(r.rule, names, has(each))
}

/** Inside an item rule a leaf reads the item (scope "parent") unless it says "document" (cross_validator.ex item_scoped). */
function itemScoped(pred: unknown): unknown {
  if (!isMap(pred)) return pred
  const key = (['all', 'any', 'one'] as const).find((k) => Array.isArray(pred[k]))
  if (key) return {...pred, [key]: (pred[key] as unknown[]).map(itemScoped)}
  return pred.scope === 'document' ? pred : {...pred, scope: 'parent'}
}

type Found = {item: Body; path: string; lists: Field[]}
/**
 * The objects in the list `each` ends at (cross_validator.ex `items`), each with its form path
 * (`meny[_key=="b"]`, by index when it has no _key) and the list fields on the way. A list on
 * the way fans out over its rows; scalars and nested lists are not items.
 */
function items(node: unknown, segs: string[], path: string, fields: Field[] | undefined, lists: Field[]): Found[] {
  if (!isMap(node) || !segs.length) return []
  const [seg, ...rest] = segs as [string, ...string[]]
  const here = path ? `${path}.${seg}` : seg
  const field = fields?.find((f) => f.name === seg)
  const value = node[seg]
  if (Array.isArray(value)) {
    const inner = field?.of?.fields
    const on = field ? [...lists, field] : lists
    if (!rest.length) return value.flatMap((it, i) => (isMap(it) ? [{item: it, path: itemPath(here, it, i), lists: on}] : []))
    return value.flatMap((it, i) => items(it, rest, itemPath(here, it, i), inner, on))
  }
  return isMap(value) && rest.length ? items(value, rest, here, field?.fields, lists) : []
}

// Barkpark's: only "warning" and "info" are warnings; any other level (a "warn" too) is an error.
const levelOf = (level: unknown): Level => (level === 'warning' ? 'warning' : level === 'info' ? 'info' : 'error')
// Where Barkpark puts a rule naming no field (cross_validator.ex `to_finding`, "/_document"), as
// the form reads a finding's path (lib/findings.ts formPath): its advisory after a save is the same problem.
const DOCUMENT = '_document'

/**
 * The violated rules as problems: one under each field the rule names (a document problem
 * when it names none), the rule's title as the message, else its name, as Barkpark's findings.
 */
export function crossProblems(doc: Doc, schema: Schema): Problem[] {
  const rules = schema.crossValidations
  if (!rules?.length) return []
  const names = new Set(['title', ...schema.fields.map((f) => f.name)])
  const describe = describeField(schema)
  return rules.flatMap((r) => {
    if (!isMap(r) || !shapeOk(r, names)) return []
    const message = r.title || r.name || 'Cross-field rule'
    const level = levelOf(r.level)
    const fields = Array.isArray(r.fields) ? r.fields.filter((f): f is string => typeof f === 'string' && f !== '') : []
    if (typeof r.each === 'string') return itemProblems(r, doc, schema, fields, message, level)
    if (holds(r.rule, doc as Record<string, unknown>)) return []
    if (!fields.length) return [{path: DOCUMENT, title: '', message, level}]
    return fields.map((path) => ({path, ...describe(path), message, level}))
  })
}

/** How many broken items one item rule names (cross_validator.ex @item_cap); the rest are one problem on the list. */
export const ITEM_CAP = 50

/**
 * An item rule's problems: on each broken item, under each field the rule names (the item
 * itself when it names none), titled as the form titles that item's field. Past ITEM_CAP
 * items, one problem on the outer field (`meny`, also for `meny.under`) says how many more, as
 * Barkpark's finding does: its path ("/meny/under") is a label, not a pointer (lib/findings keyedAt).
 */
function itemProblems(r: CrossRule, doc: Doc, schema: Schema, fields: string[], message: string, level: Level): Problem[] {
  const body = itemScoped(r.rule)
  const segs = (r.each as string).split('.')
  const outer = schema.fields.find((f) => f.name === segs[0])
  const group = outer?.group
  const broken = items(doc, segs, '', schema.fields, []).filter(({item}) => !((r.type !== undefined && r.type !== null && item._type !== r.type) || holds(body, doc as Record<string, unknown>, item)))
  const more = broken.length - ITEM_CAP
  const summary: Problem[] = more > 0 ? [{path: segs[0]!, title: outer?.title ?? segs[0]!, ...(group ? {group} : {}), message: `${message} (${more} more ${more === 1 ? 'item' : 'items'})`, level}] : []
  return broken.slice(0, ITEM_CAP).flatMap(({path, lists}) => {
    const parents = lists.map((f) => f.title ?? f.name)
    const at = {...(group ? {group} : {}), message, level}
    if (!fields.length) return [{path, title: parents.pop() ?? '', ...(parents.length ? {parents} : {}), ...at}]
    const own = lists.at(-1)?.of?.fields
    return fields.map((f) => ({path: `${path}.${f}`, title: own?.find((x) => x.name === f)?.title ?? f, parents, ...at}))
  }).concat(summary)
}
