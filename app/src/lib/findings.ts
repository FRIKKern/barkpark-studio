// Barkpark's validation findings in the studio's words: a refusal (422 validation_failed,
// barkpark#22375) or, on a dataset that does not enforce its schema, the advisory
// warnings a save answers with (#22406). Each finding carries a stable `code` and its `params`; the studio
// says it the way its own checks do (lib/validation.ts, Sanity's wording) in the
// editor's language, and falls back to Barkpark's English for a code it does not know.
// `custom` is the schema author's own text: shown as written.

import type {Field, Schema} from './data'
import type {Level, Problem} from './validation'

export type Finding = {path: string; message: string; code: string; params?: Record<string, unknown>}
type Translate = (en: string, vars?: Record<string, string | number>) => string

const SENTENCES: Record<string, string> = {
  required: 'Required',
  pattern_mismatch: 'Does not match the required format',
  expected_object: 'Expected an object',
  expected_list: 'Expected a list',
  codelist_not_string: 'Must be a code (text)',
  codelist_empty: 'Must not be empty',
  codelist_has_whitespace: 'Must not contain spaces',
  localized_text_shape: 'Expected a text per language',
  language_key_not_string: 'Language keys must be text',
  language_not_declared: 'Language "{lang}" is not one of the declared languages',
  rich_text_shape: 'Expected rich text',
  text_not_string: 'Must be text',
  image_shape: 'Expected an image',
  file_shape: 'Expected a file',
  rect_shape: 'Expected an object with {sides}',
  rect_out_of_range: 'Must be a number from {min} to {max}',
  missing_type: 'An item is missing its type',
  unknown_type: 'Unknown item type "{type_name}"',
  block_fields_invalid: "The block's declared fields could not be read",
  not_in_list: 'Must be one of {allowed}',
  list_too_short: 'Must have at least {min} items',
  list_too_long: 'Must have at most {max} items',
  list_not_unique: 'Items must be unique',
  number_too_small: 'Must be greater than or equal to {min}',
  number_too_large: 'Must be lower than or equal to {max}',
  string_too_short: 'Must be at least {min} characters long',
  string_too_long: 'Must be at most {max} characters long',
}

const param = (v: unknown) => (Array.isArray(v) ? v.join(', ') : typeof v === 'number' ? v : String(v ?? ''))

/** One finding as a sentence in the editor's language. */
export function findingSentence(f: Finding, t: Translate): string {
  const en = SENTENCES[f.code]
  if (!en) return f.message
  return t(en, Object.fromEntries(Object.entries(f.params ?? {}).map(([k, v]) => [k, param(v)])))
}

/** Every finding, "Field: sentence.", the field named by its title where the schema has one. */
export function findingsReason(findings: Finding[], titleOf: (path: string) => string | undefined, t: Translate): string {
  return findings
    .map((f) => {
      const s = findingSentence(f, t)
      const title = titleOf(f.path) ?? f.path
      return `${title ? `${title}: ` : ''}${s}${/[.!?]$/.test(s) ? '' : '.'}`
    })
    .join(' ')
}

/** The findings of a thrown "mutate 422: {error: {code: validation_failed, findings}}", if that is what it is. */
export function findingsOf(msg: string): Finding[] | undefined {
  if (!/^mutate 422\b/.test(msg)) return undefined
  try {
    const body = JSON.parse(msg.slice(msg.indexOf('{'))) as {error?: {code?: string; findings?: Finding[]}}
    return body.error?.code === 'validation_failed' && body.error.findings?.length ? body.error.findings : undefined
  } catch {
    return undefined
  }
}

/** The advisory findings a save answered with (warnings of code schema_validation, #22406). */
export function advisoryFindings(body: unknown): Finding[] {
  const warnings = (body as {warnings?: {code?: string; findings?: Finding[]}[]} | null)?.warnings ?? []
  return warnings.flatMap((w) => (w.code === 'schema_validation' && Array.isArray(w.findings) ? w.findings : []))
}

/** A finding's path as the form's: "/seo/metaDescription" → "seo.metaDescription". */
export const formPath = (path: string) => path.replace(/^[$/.]+/, '').replace(/\//g, '.')

/**
 * Barkpark's advisory findings (#22406) for the rules
 * (array lengths, patterns, allowed values, shapes) that lib/validation.ts does not
 * check itself: one problem each, in the studio's words, at its field's level. A path
 * the studio already flags is left to it.
 */
export function advisoryProblems(findings: Finding[], schema: Schema, known: Problem[], t: Translate): Problem[] {
  const flagged = new Set(known.map((p) => p.path))
  return findings.flatMap((f) => {
    const path = formPath(f.path)
    if (flagged.has(path)) return []
    const parents: string[] = []
    let fields: Field[] | undefined = schema.fields
    let field: Field | undefined
    for (const name of path.split('.').filter((p) => p && !/^\d+$|^\[/.test(p))) {
      field = fields?.find((x) => x.name === name)
      if (!field) break
      fields = field.fields ?? field.of?.fields
      if (fields && field.type === 'composite') parents.push(field.title ?? field.name)
    }
    if (field?.type === 'composite') parents.pop()
    const level = field ? levelOfField(field) : 'error'
    return [{path, title: field?.title ?? field?.name ?? path, message: findingSentence(f, t), level, ...(parents.length ? {parents} : {}), group: field?.group}]
  })
}

// A field's level as lib/validation.ts reads its rules: warning / info if a rule says so.
function levelOfField(field: Field): Level {
  const rules = Array.isArray(field.validation) ? field.validation : field.validation ? [field.validation] : []
  const l = rules.find((r) => r.level)?.level
  return l === 'warning' || l === 'warn' ? 'warning' : l === 'info' ? 'info' : 'error'
}
