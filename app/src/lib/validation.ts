import type {Doc, Field, Rule, Schema} from './data'
import {itemPath, refId} from './refs.ts'
import type {T} from './i18n'

// The schema's validation rules, checked as you type, with Sanity's wording.
// Barkpark keeps rules as data on each field: a map or a list of maps
// (`{required, min, max, pattern, level, message}`). J13: only errors block publishing;
// a warning or an info is shown the same ways in its own colour.
export type Level = 'error' | 'warning' | 'info'
/** `parents`: the titles of the objects the field sits in (Sanity's "Seo / Meta Title"). */
export type Problem = {path: string; title: string; message: string; level: Level; parents?: string[]; group?: string}
/** A referenced doc as the cache has it: null = no such doc, undefined = still loading. */
export type RefTarget = (id: string) => Doc | null | undefined

// The messages are English keys; `validate` takes the render's translate (B01).
const english: T = (en, vars) => (vars ? en.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all)) : en)

const blank = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
// Barkpark's levels too: warning and info never block a save or a publish (barkpark#22125).
const levelOf = (r: Rule): Level => (r.level === 'warning' || r.level === 'warn' ? 'warning' : r.level === 'info' ? 'info' : 'error')
const regexOf = (pattern: string) => {
  try {
    return new RegExp(pattern)
  } catch {
    return null
  }
}
const rulesOf = (field: Field): Rule[] => (Array.isArray(field.validation) ? field.validation : field.validation ? [field.validation] : [])

function check(field: Field, value: unknown, path: string, parents: string[], group: string | undefined, out: Problem[], target: RefTarget | undefined, t: T) {
  const title = field.title ?? field.name
  const push = (rule: Rule, message: string) => out.push({path, title, message: rule.message ?? message, level: levelOf(rule), ...(parents.length ? {parents} : {}), group})
  const rules = rulesOf(field)
  const required = rules.find((r) => r.required)
  if (required && blank(value)) return push(required, t('Required'))
  if (blank(value)) return
  // A slug's text is its `current` when Sanity-shaped.
  const text = typeof value === 'string' ? value : field.type === 'slug' && typeof (value as {current?: unknown})?.current === 'string' ? (value as {current: string}).current : undefined
  for (const r of rules) {
    // Sanity's Rule.regex (Barkpark enforces `pattern` on write); a pattern that isn't a valid regex is skipped.
    if (r.pattern !== undefined && text !== undefined && text !== '') {
      const re = regexOf(r.pattern)
      if (re && !re.test(text)) push(r, t('Does not match "{pattern}"-pattern', {pattern: `/${r.pattern}/`}))
    }
    if (field.type === 'number' && typeof value === 'number') {
      if (r.max !== undefined && value > r.max) push(r, t('Must be lower than or equal to {max}', {max: r.max}))
      if (r.min !== undefined && value < r.min) push(r, t('Must be greater than or equal to {min}', {min: r.min}))
    } else if (typeof value === 'string') {
      if (r.max !== undefined && value.length > r.max) push(r, t('Must be at most {max} characters long', {max: r.max}))
      if (r.min !== undefined && value.length < r.min) push(r, t('Must be at least {min} characters long', {min: r.min}))
    }
  }
  // Sanity: a reference must point at a published doc (a missing one fails the same way).
  if (field.type === 'reference' && typeof value === 'string' && target) {
    const doc = target(value)
    if (doc === null || doc?._hasPublished === false) push({}, t('Referenced document must be published'))
  }
  // Sanity: an empty row in an array of references is an error on that row.
  if (field.of?.type === 'reference' && Array.isArray(value))
    value.forEach((it, i) => refId(it) || out.push({path: itemPath(path, it, i), title, message: t('Must be a reference to a document'), level: 'error', ...(parents.length ? {parents} : {}), group}))
  if (field.type === 'composite')
    for (const f of field.fields ?? []) check(f, (value as Record<string, unknown>)?.[f.name], `${path}.${f.name}`, [...parents, title], group, out, target, t)
}

/** `t`: the render's translate (useT), so the messages are in the Studio's language. */
export function validate(doc: Doc, schema: Schema, target?: RefTarget, t: T = english): Problem[] {
  const out: Problem[] = []
  for (const f of schema.fields) check(f, doc[f.name], f.name, [], f.group, out, target, t)
  return out
}

const rank: Record<Level, number> = {error: 0, warning: 1, info: 2}
/** The most serious level among these problems (what a tab or the header button shows). */
export const worst = (problems: Problem[]): Level | undefined => problems.reduce<Level | undefined>((w, p) => (!w || rank[p.level] < rank[w] ? p.level : w), undefined)
export const errorsOf = (problems: Problem[]) => problems.filter((p) => p.level === 'error')
