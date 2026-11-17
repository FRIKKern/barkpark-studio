import type {Field, Rule} from './data'
import {formatWall} from './date-format.ts'
import {imageRef} from './image.ts'
import type {T} from './i18n'

// Sanity's other rule builders, as data on a field (sanity 6.17.0, @sanity/validation's
// validators/{string,number,date,array,object}Validator.ts; Rule.ts in @sanity/schema for
// positive() and negative()): Rule.length, precision, greaterThan, lessThan, positive,
// negative, lowercase, uppercase, regex's name and invert, a date's min and max, and
// assetRequired. They run in the studio only, as Sanity's do: Barkpark stores these keys
// and never runs them (its docs/contracts/schema-unknown-keys.md), so an API write or an
// import is not checked by them. lib/validation.ts calls this for each rule of a field
// with a value; an empty field is left to `required`, as in Sanity.

const isDate = (type: string) => type === 'date' || type === 'datetime'
/** Sanity's parseDate: "now", or anything Date reads; null when it can't. */
const dateOf = (v: unknown): Date | null => {
  if (v === 'now') return new Date()
  const d = typeof v === 'string' || typeof v === 'number' ? new Date(v) : null
  return d && !Number.isNaN(d.getTime()) ? d : null
}
// Sanity's legacyDateFormat: options.dateFormat (default YYYY-MM-DD), a datetime adds
// options.timeFormat (default HH:mm) in the computer's zone; a date alone is read in UTC.
function shownDate(field: Field, d: Date): string {
  const o = (field.options ?? {}) as {dateFormat?: string; timeFormat?: string}
  const date = o.dateFormat || 'YYYY-MM-DD'
  if (field.type === 'date') return formatWall({year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes()}, date)
  return formatWall({year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes()}, `${date} ${o.timeFormat || 'HH:mm'}`)
}
// Sanity's numberValidator: the places after the point, less a negative exponent's (1e-7 has 7).
const precisionRx = /(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/
const decimals = (n: number) => {
  const m = n.toString().match(precisionRx)!
  return Math.max((m[1] ? m[1].length : 0) - (m[2] ? parseInt(m[2], 10) : 0), 0)
}

/** True when `rule.min` / `rule.max` on this field is a date, not a length or a number. */
export const isDateBound = (field: Field, bound: unknown) => isDate(field.type) && typeof bound === 'string'

/**
 * This rule's problems with `value` (a non-empty value of `field`), in Sanity's words. The
 * rule's own `message` replaces each, at the caller.
 */
export function sanityRules(field: Field, rule: Rule, value: unknown, t: T): string[] {
  const out: string[] = []
  const r = rule
  if (typeof value === 'string') {
    if (typeof r.length === 'number' && value.length !== r.length) out.push(t('Must be exactly {wantedLength} characters long', {wantedLength: r.length}))
    if (r.uppercase && value !== value.toLocaleUpperCase()) out.push(t('Must be all uppercase characters'))
    if (r.lowercase && value !== value.toLocaleLowerCase()) out.push(t('Must be all lowercase characters'))
  }
  if (typeof value === 'number') {
    if (typeof r.precision === 'number' && decimals(value) > r.precision) out.push(t('Max precision is {limit}', {limit: r.precision}))
    // Sanity: positive() is min(0); negative() is lessThan(0).
    if (r.positive && !(value >= 0)) out.push(t('Must be greater than or equal to {min}', {min: 0}))
    if (typeof r.greaterThan === 'number' && !(value > r.greaterThan)) out.push(t('Must be greater than {threshold}', {threshold: r.greaterThan}))
    if (typeof r.lessThan === 'number' && !(value < r.lessThan)) out.push(t('Must be less than {threshold}', {threshold: r.lessThan}))
    if (r.negative && !(value < 0)) out.push(t('Must be less than {threshold}', {threshold: 0}))
  }
  if (Array.isArray(value) && typeof r.length === 'number' && value.length !== r.length)
    out.push(field.type === 'richText' ? t('Must have exactly {wantedLength} blocks', {wantedLength: r.length}) : t('Must have exactly {wantedLength} items', {wantedLength: r.length}))
  // A date's bounds (Sanity's Rule.min / Rule.max on a date or datetime); a value Date can't read is left to the type's rule.
  if (isDate(field.type)) {
    const at = dateOf(value)
    const min = isDateBound(field, r.min) ? dateOf(r.min) : null
    const max = isDateBound(field, r.max) ? dateOf(r.max) : null
    if (at && min && at < min) out.push(t('Must be at or after {minDate}', {minDate: shownDate(field, min)}))
    if (at && max && at > max) out.push(t('Must be at or before {maxDate}', {maxDate: shownDate(field, max)}))
  }
  // Sanity's assetRequired: an image or file object with no asset in it (alt text alone, say).
  if (r.assetRequired && !(typeof value === 'string' || imageRef(value)))
    out.push(field.type === 'image' ? t('Image is required') : field.type === 'file' ? t('File is required') : t('Asset is required'))
  return out
}

/** Sanity's regex message: its name, or the pattern as /source/; inverted, a match is the problem. */
export function patternProblem(rule: Rule, text: string, t: T): string | undefined {
  if (rule.pattern === undefined) return undefined
  let re: RegExp
  try {
    re = new RegExp(rule.pattern)
  } catch {
    return undefined // a pattern that isn't a valid regex is skipped
  }
  const name = rule.name || `/${rule.pattern}/`
  const matches = re.test(text)
  if (rule.invert) return matches ? t('Should not match "{name}"-pattern', {name}) : undefined
  return matches ? undefined : t('Does not match "{pattern}"-pattern', {pattern: name})
}
