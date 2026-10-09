// Barkpark's validation refusal (422 validation_failed) in the studio's words. Since
// barkpark#22375 each finding carries a stable `code` and its `params`; the studio
// says it the way its own checks do (lib/validation.ts, Sanity's wording) in the
// editor's language, and falls back to Barkpark's English for a code it does not know.
// `custom` is the schema author's own text: shown as written.

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
