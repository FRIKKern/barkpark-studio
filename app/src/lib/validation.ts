import type {Doc, Field, Rule, Schema} from './data'
import {itemPath, refId} from './refs.ts'
import {isCodeField} from './code-input.ts'
import {isTableField, tableBlank} from './table-input.ts'
import {patternProblem, sanityRules} from './validation-rules.ts'
import {crossProblems} from './cross-rules.ts'
import {outsideList} from './list-options.ts'
import {narrowImage, type WidthOf} from './image-min-width.ts'
import type {T} from './i18n'

// The schema's validation rules, checked as you type, with Sanity's wording.
// Barkpark keeps rules as data on each field: a map or a list of maps
// (`{required, min, max, pattern, unique, level, message}`, Barkpark's
// docs/contracts/schema-reference.md), and Sanity's other rule builders (lib/validation-rules). J13: only errors block publishing;
// a warning or an info is shown the same ways in its own colour.
export type Level = 'error' | 'warning' | 'info'
/** `parents`: the titles of the objects the field sits in (Sanity's "Seo / Meta Title"). */
/** `parse`: an input's unreadable text (lib/parse-errors), shown as an error but, as Sanity's, not blocking Publish. */
export type Problem = {path: string; title: string; message: string; level: Level; parents?: string[]; group?: string; parse?: true}
/** A referenced doc as the cache has it: null = no such doc, undefined = still loading. */
export type RefTarget = (id: string) => Doc | null | undefined

// The messages are English keys; `validate` takes the render's translate (B01).
const english: T = (en, vars) => (vars ? en.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all)) : en)

const blank = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
// Barkpark's levels too: warning and info never block a save or a publish (barkpark#22125).
const levelOf = (r: Rule): Level => (r.level === 'warning' || r.level === 'warn' ? 'warning' : r.level === 'info' ? 'info' : 'error')
const rulesOf = (field: Field): Rule[] => (Array.isArray(field.validation) ? field.validation : field.validation ? [field.validation] : [])

/**
 * Whether this person cannot change the field at `at` here (hidden or read-only): the form's
 * rule, conditions.ts fieldState, as the pane asks it with the person and the studio config.
 */
export type Shut = (f: Field, at: {path: string; value: unknown; parent?: Record<string, unknown>}) => boolean
const open: Shut = () => false

/** Where a field sits: the object around it, the rule to ask, whether an object around it is shut already (readOnly or hidden for this person), and what is known of an image's width. */
type Scope = {ask: Shut; parent?: Record<string, unknown>; shut: boolean; widthOf?: WidthOf}

function check(field: Field, value: unknown, path: string, parents: string[], group: string | undefined, out: Problem[], target: RefTarget | undefined, t: T, at: Scope) {
  const title = field.title ?? field.name
  const push = (rule: Rule, message: string) => out.push({path, title, message: rule.message ?? message, level: levelOf(rule), ...(parents.length ? {parents} : {}), group})
  const rules = rulesOf(field)
  const required = rules.find((r) => r.required)
  // A code object with no code in it is empty too (its language alone is not a value).
  // So is a table with no text in any cell.
  if (required && (blank(value) || (isCodeField(field) && blank((value as {code?: unknown}).code)) || (isTableField(field) && tableBlank(value)))) return push(required, t('Required'))
  if (blank(value)) return
  const shut = at.shut || at.ask(field, {path, value, parent: at.parent})
  // A slug's text is its `current` when Sanity-shaped.
  const text = typeof value === 'string' ? value : field.type === 'slug' && typeof (value as {current?: unknown})?.current === 'string' ? (value as {current: string}).current : undefined
  for (const r of rules) {
    // Sanity's Rule.regex, named or inverted (Barkpark enforces a plain `pattern` on write).
    const mismatch = text !== undefined && text !== '' ? patternProblem(r, text, t) : undefined
    if (mismatch) push(r, mismatch)
    // An arrayOf with no two items alike (Sanity's Rule.unique()): the same reference or value.
    if (r.unique && Array.isArray(value)) {
      const seen = value.map((it) => refId(it) ?? JSON.stringify(it && typeof it === 'object' ? {...(it as object), _key: undefined} : it))
      if (new Set(seen).size !== seen.length) push(r, t("Can't be a duplicate"))
    }
    // A number min / max is a length or a number; a string one on a date is a date (lib/validation-rules).
    const [min, max] = [typeof r.min === 'number' ? r.min : undefined, typeof r.max === 'number' ? r.max : undefined]
    if (field.type === 'number' && typeof value === 'number') {
      if (max !== undefined && value > max) push(r, t('Must be lower than or equal to {max}', {max}))
      if (min !== undefined && value < min) push(r, t('Must be greater than or equal to {min}', {min}))
    } else if (typeof value === 'string') {
      if (max !== undefined && value.length > max) push(r, t('Must be at most {max} characters long', {max}))
      if (min !== undefined && value.length < min) push(r, t('Must be at least {min} characters long', {min}))
    } else if (Array.isArray(value)) {
      // An array's item count, as you type (Sanity's); Barkpark's save says the same after.
      if (max !== undefined && value.length > max) push(r, t('Must have at most {max} items', {max}))
      if (min !== undefined && value.length < min) push(r, t('Must have at least {min} items', {min}))
    }
    for (const message of sanityRules(field, r, value, t)) push(r, message)
  }
  // Sanity's field types carry rules of their own: a URL, an email, a whole number, a date.
  const wrongShape = typeRule(field.type, value, t)
  if (wrongShape) push({}, wrongShape)
  // Sanity's rule from options.list (`valid(list)`): a value the list doesn't hold is said, and kept.
  // On a field the editor can't change here (readOnly or hidden for this document) it is a
  // warning, never blocking Publish: a list that changed must not lock anyone out (unlike Sanity).
  if (outsideList(field, value)) push({level: shut ? 'warning' : 'error'}, notAllowed(value, t))
  // An image narrower than options.minWidth: a warning only, its own words (lib/image-min-width).
  const narrow = narrowImage(field.type, field.options, value, at.widthOf, t)
  if (narrow) push({level: 'warning'}, narrow)
  // Sanity: a strong reference must point at a published doc (a missing one fails the same
  // way), a bare id or Sanity's object alike. A weak field's may point anywhere (Sanity's).
  const ref = field.type === 'reference' && !field.weak ? refId(value) : undefined
  if (ref && target) {
    const doc = target(ref)
    if (doc === null || doc?._hasPublished === false) push({}, t('Referenced document must be published'))
  }
  // Sanity: an empty row in an array of references is an error on that row.
  if (field.of?.type === 'reference' && Array.isArray(value))
    value.forEach((it, i) => refId(it) || out.push({path: itemPath(path, it, i), title, message: t('Must be a reference to a document'), level: 'error', ...(parents.length ? {parents} : {}), group}))
  if (field.type === 'composite' && !isCodeField(field) && !isTableField(field))
    for (const f of field.fields ?? []) check(f, (value as Record<string, unknown>)?.[f.name], `${path}.${f.name}`, [...parents, title], group, out, target, t, {ask: at.ask, parent: value as Record<string, unknown>, shut, widthOf: at.widthOf})
  // An array's items are checked too (Sanity's "Links / External link / URL"): an object
  // item's fields under the item's kind, a plain item by its type's own rule.
  const of = field.of
  if (of && of.type !== 'reference' && Array.isArray(value))
    value.forEach((it, i) => {
      const item = itemPath(path, it, i)
      if (of.type === 'composite' && it && typeof it === 'object') {
        const opts = (of.options ?? {}) as {typeField?: string; fieldsByType?: Record<string, string[]>}
        const kind = opts.typeField ? (it as Record<string, unknown>)[opts.typeField] : undefined
        const kindField = opts.typeField ? of.fields?.find((f) => f.name === opts.typeField) : undefined
        const kindTitle = typeof kind === 'string' ? ((kindField?.options as {value: string; title?: string}[] | undefined)?.find((o) => o.value === kind)?.title ?? kind) : undefined
        const shown = typeof kind === 'string' && opts.fieldsByType?.[kind]
        for (const f of of.fields ?? [])
          if (!shown || shown.includes(f.name)) check(f, (it as Record<string, unknown>)[f.name], `${item}.${f.name}`, [...parents, title, ...(kindTitle ? [kindTitle] : [])], group, out, target, t, {ask: at.ask, parent: it as Record<string, unknown>, shut, widthOf: at.widthOf})
      } else {
        const shape = typeRule(of.type, it, t)
        if (shape) out.push({path: item, title, message: shape, level: 'error', ...(parents.length ? {parents} : {}), group})
        // An image member narrower than the member's options.minWidth (a gallery's): a warning on the item.
        const narrow = narrowImage(of.type, of.options, it, at.widthOf, t)
        if (narrow) out.push({path: item, title, message: narrow, level: 'warning', ...(parents.length ? {parents} : {}), group})
      }
    })
}

/** A value of the wrong shape for its type, in Sanity's words (its url, email, number and date validators). */
function typeRule(type: string, value: unknown, t: T): string | undefined {
  if (type === 'url' && typeof value === 'string') {
    // Sanity's url type: absolute, http or https only, no username or password in it.
    const url = URL.canParse(value) ? new URL(value) : null
    if (!url) return t('Not a valid URL')
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return t('Does not match allowed protocols/schemes')
    if (url.username || url.password) return t('Username/password not allowed')
  }
  if (type === 'email' && typeof value === 'string' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return t('Must be a valid email address')
  if (type === 'integer' && typeof value === 'number' && !Number.isInteger(value)) return t('Must be an integer')
  if ((type === 'date' || type === 'datetime') && typeof value === 'string' && Number.isNaN(Date.parse(value))) return t('Must be a valid ISO-8601 formatted date string')
  return undefined
}

/** Sanity's words for a value outside the list: the value itself, cut at 30 characters. */
function notAllowed(value: unknown, t: T): string {
  const text = typeof value === 'number' || typeof value === 'string' ? String(value) : ''
  return text ? t('Value "{value}" did not match any allowed values', {value: text.length > 30 ? `${text.slice(0, 30)}…` : text}) : t('Value did not match any allowed values')
}

/**
 * `t`: the render's translate (useT), so the messages are in the Studio's language. `shut`: the
 * field rule for this person (fieldState, as the pane asks it); without one no field is shut,
 * so a value outside its list is an error everywhere (Sanity's). `widthOf`: what is known of an
 * image asset's width (the pane's media-info reads); without it no image is judged narrow.
 */
export function validate(doc: Doc, schema: Schema, target?: RefTarget, t: T = english, shut: Shut = open, widthOf?: WidthOf): Problem[] {
  const out: Problem[] = []
  for (const f of schema.fields) check(f, doc[f.name], f.name, [], f.group, out, target, t, {ask: shut, shut: false, widthOf})
  // The schema's cross-field rules (lib/cross-rules), as Barkpark checks them on write.
  out.push(...crossProblems(doc, schema))
  return out
}

const rank: Record<Level, number> = {error: 0, warning: 1, info: 2}
/** The most serious level among these problems (what a tab or the header button shows). */
/**
 * Two problem paths in the form's order (Sanity's panel): field by field down the path, so
 * "seo.metaTitle" comes before "seo.metaDescription"; a document rule ("") first. Below an
 * array item the order is left to the caller.
 */
export function formOrder(schema: Schema | undefined, a: string, b: string): number {
  const rank = (path: string) => {
    const out: number[] = []
    let fields: Field[] | undefined = schema?.fields
    for (const seg of path.split('.')) {
      const i = fields?.findIndex((f) => f.name === seg.split('[')[0]) ?? -1
      out.push(i)
      if (i < 0 || seg.includes('[')) break
      fields = (fields![i] as {fields?: Field[]}).fields
    }
    return out
  }
  const [x, y] = [rank(a), rank(b)]
  for (let k = 0; k < Math.max(x.length, y.length); k++) {
    const d = (x[k] ?? -1) - (y[k] ?? -1)
    if (d) return d
  }
  return 0
}
export const worst = (problems: Problem[]): Level | undefined => problems.reduce<Level | undefined>((w, p) => (!w || rank[p.level] < rank[w] ? p.level : w), undefined)
export const errorsOf = (problems: Problem[]) => problems.filter((p) => p.level === 'error')
