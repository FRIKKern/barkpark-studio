import type {Doc, Schema} from './data'
import type {Level, Problem} from './validation'
import {holds} from './conditions.ts'
import {describeField} from './custom-rules.ts'

// A schema's cross-field rules (Barkpark's `cross_validations`, api/lib/barkpark/content/
// cross_validator.ex): `{name, title, rule, level, fields}`, where `rule` is a leaf
// `{field, operator, value?}` or `all` / `any` of them, nested. Barkpark checks them at every
// write; the studio shows them as you type, under each field the rule names.

export type CrossRule = {name?: string; title?: string; rule?: unknown; level?: string; fields?: unknown}

// The server's operators (cross_validator.ex @operators). A rule using any other is
// unevaluable there and never a finding, so it is skipped here too, quietly.
const OPERATORS = new Set(['eq', 'neq', 'in', 'empty', 'non_empty', 'starts_with', 'count_eq', 'count_neq', 'count_gt', 'count_lt'])

type Body = Record<string, unknown>

/** The served rules as the studio's schema keeps them: none (no key) when the type has none, so it reads as before. */
export const crossRulesOf = (rules: unknown): {crossValidations?: CrossRule[]} =>
  Array.isArray(rules) && rules.length ? {crossValidations: rules as CrossRule[]} : {}
const isMap = (v: unknown): v is Body => !!v && typeof v === 'object' && !Array.isArray(v)

/** Whether the server can evaluate this body (cross_validator.ex `partition`): known operators on declared fields. */
function evaluable(body: unknown, names: Set<string>): boolean {
  if (!isMap(body) || !Object.keys(body).length) return false
  // Elixir's `all || any`: false and null fall through.
  const truthy = (v: unknown) => (v === false || v === null || v === undefined ? undefined : v)
  const preds = truthy(body.all) ?? truthy(body.any)
  if (preds !== undefined) return Array.isArray(preds) && preds.length > 0 && preds.every((p) => evaluable(p, names))
  const {field, operator} = body
  return typeof field === 'string' && field !== '' && typeof operator === 'string' && OPERATORS.has(operator) && names.has(field.split('.')[0]!)
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
    if (!isMap(r) || !evaluable(r.rule, names) || holds(r.rule, doc as Record<string, unknown>)) return []
    const message = r.title || r.name || 'Cross-field rule'
    const fields = Array.isArray(r.fields) ? r.fields.filter((f): f is string => typeof f === 'string' && f !== '') : []
    if (!fields.length) return [{path: DOCUMENT, title: '', message, level: levelOf(r.level)}]
    return fields.map((path) => ({path, ...describe(path), message, level: levelOf(r.level)}))
  })
}
