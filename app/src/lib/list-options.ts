import type {Field} from './data'

// Sanity's `options.list` on a string (Barkpark's `select`) or a number (`number`, `integer`,
// `float`): the choices a field offers, read in one place for the form, validation and paste
// (G4, task-20bc1ba720eafef2). A value is kept exactly as the schema gives it: 6 stays the
// number 6, 0.5 stays 0.5, "6" stays a string. Pure (no React): node's tests load it.

export type ListOption = {value: unknown; title: string; bad?: true}

const NUMBERS = new Set(['number', 'integer', 'float'])
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The list as written: `options` itself (Barkpark's), or `options.list` (Sanity's). */
function rawList(options: unknown): unknown[] | null {
  if (Array.isArray(options)) return options
  const list = options && typeof options === 'object' ? (options as {list?: unknown}).list : undefined
  return Array.isArray(list) ? list : null
}

/** Whether the field draws a list of choices: a select, or a number field with a list. */
export const hasList = (f: Pick<Field, 'type' | 'options'>): boolean => f.type === 'select' || (NUMBERS.has(f.type) && !!rawList(f.options)?.length)

/** Whether `value` fits a number field of this type: a finite number, whole for an integer. */
const fitsNumber = (type: string, value: unknown) => typeof value === 'number' && Number.isFinite(value) && (type !== 'integer' || Number.isInteger(value))

/**
 * The field's choices: plain values (titled by their text), or `{value, title}` (legacy
 * `{value, label}`). On a number field an entry that is not a number of its type (the string
 * "3", or 0.5 on an integer) is `bad`: drawn but not choosable, never coerced to one.
 */
export function listOptions(f: Pick<Field, 'type' | 'options'>): ListOption[] {
  return (rawList(f.options) ?? []).map((o) => {
    const pair = !!o && typeof o === 'object'
    const value = pair ? (o as {value: unknown}).value : o
    const title = pair ? String((o as {title?: unknown}).title ?? (o as {label?: unknown}).label ?? value) : capitalize(String(o))
    return NUMBERS.has(f.type) && !fitsNumber(f.type, value) ? {value, title, bad: true} : {value, title}
  })
}

/** The values a choice may store: the list's good entries. */
export const listValues = (f: Pick<Field, 'type' | 'options'>): unknown[] => listOptions(f).flatMap((o) => (o.bad ? [] : [o.value]))

/**
 * Sanity's rule for a field with a list (`valid(list)`, inferred from `options.list`): a stored
 * value the list does not hold (the list changed later, or another client wrote it). It is
 * shown and kept as it is, never rewritten; the form says so. Nothing stored, or a list with no entries, is never outside.
 */
export function outsideList(f: Pick<Field, 'type' | 'options'>, value: unknown): boolean {
  if (value === undefined || value === null || !hasList(f)) return false
  const options = listOptions(f)
  return options.length > 0 && !options.some((o) => !o.bad && o.value === value)
}
