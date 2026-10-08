import type {Doc, Field, Rule, Schema} from './data'

// The schema's validation rules, checked as you type, with Sanity's wording.
// Barkpark keeps rules as data on each field: a map or a list of maps
// (`{required, min, max, level, message}`). J13: only errors block publishing;
// a warning or an info is shown the same ways in its own colour.
export type Level = 'error' | 'warning' | 'info'
/** `parents`: the titles of the objects the field sits in (Sanity's "Seo / Meta Title"). */
export type Problem = {path: string; title: string; message: string; level: Level; parents?: string[]; group?: string}
/** A referenced doc as the cache has it: null = no such doc, undefined = still loading. */
export type RefTarget = (id: string) => Doc | null | undefined

const blank = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
// Barkpark's server knows warning; info is ours until it does (task-b183e15684138399).
const levelOf = (r: Rule): Level => (r.level === 'warning' || r.level === 'warn' ? 'warning' : r.level === 'info' ? 'info' : 'error')
const rulesOf = (field: Field): Rule[] => (Array.isArray(field.validation) ? field.validation : field.validation ? [field.validation] : [])

function check(field: Field, value: unknown, path: string, parents: string[], group: string | undefined, out: Problem[], target?: RefTarget) {
  const title = field.title ?? field.name
  const push = (rule: Rule, message: string) => out.push({path, title, message: rule.message ?? message, level: levelOf(rule), ...(parents.length ? {parents} : {}), group})
  const rules = rulesOf(field)
  const required = rules.find((r) => r.required)
  if (required && blank(value)) return push(required, 'Required')
  if (blank(value)) return
  for (const r of rules) {
    if (field.type === 'number' && typeof value === 'number') {
      if (r.max !== undefined && value > r.max) push(r, `Must be lower than or equal to ${r.max}`)
      if (r.min !== undefined && value < r.min) push(r, `Must be greater than or equal to ${r.min}`)
    } else if (typeof value === 'string') {
      if (r.max !== undefined && value.length > r.max) push(r, `Must be at most ${r.max} characters long`)
      if (r.min !== undefined && value.length < r.min) push(r, `Must be at least ${r.min} characters long`)
    }
  }
  // Sanity: a reference must point at a published doc (a missing one fails the same way).
  if (field.type === 'reference' && typeof value === 'string' && target) {
    const doc = target(value)
    if (doc === null || doc?._hasPublished === false) push({}, 'Referenced document must be published')
  }
  if (field.type === 'composite')
    for (const f of field.fields ?? []) check(f, (value as Record<string, unknown>)?.[f.name], `${path}.${f.name}`, [...parents, title], group, out, target)
}

export function validate(doc: Doc, schema: Schema, target?: RefTarget): Problem[] {
  const out: Problem[] = []
  for (const f of schema.fields) check(f, doc[f.name], f.name, [], f.group, out, target)
  return out
}

const rank: Record<Level, number> = {error: 0, warning: 1, info: 2}
/** The most serious level among these problems (what a tab or the header button shows). */
export const worst = (problems: Problem[]): Level | undefined => problems.reduce<Level | undefined>((w, p) => (!w || rank[p.level] < rank[w] ? p.level : w), undefined)
export const errorsOf = (problems: Problem[]) => problems.filter((p) => p.level === 'error')
