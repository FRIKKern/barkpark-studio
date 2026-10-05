import type {Doc, Field, Schema} from './data'

// The schema's validation rules, checked as you type, with Sanity's wording.
// Barkpark keeps rules as data on each field (`validation: {required, min, max}`).
export type Problem = {path: string; title: string; message: string; group?: string}

const blank = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)

function check(field: Field, value: unknown, path: string, group: string | undefined, out: Problem[]) {
  const title = field.title ?? field.name
  const rules = field.validation ?? {}
  const push = (message: string) => out.push({path, title, message, group})
  if (rules.required && blank(value)) return push('Required')
  if (blank(value)) return
  if (field.type === 'number' && typeof value === 'number') {
    if (rules.max !== undefined && value > rules.max) push(`Must be lower than or equal to ${rules.max}`)
    if (rules.min !== undefined && value < rules.min) push(`Must be greater than or equal to ${rules.min}`)
  } else if (typeof value === 'string') {
    if (rules.max !== undefined && value.length > rules.max) push(`Must be at most ${rules.max} characters long`)
    if (rules.min !== undefined && value.length < rules.min) push(`Must be at least ${rules.min} characters long`)
  }
  if (field.type === 'composite')
    for (const f of field.fields ?? []) check(f, (value as Record<string, unknown>)?.[f.name], `${path}.${f.name}`, group, out)
}

export function validate(doc: Doc, schema: Schema): Problem[] {
  const out: Problem[] = []
  for (const f of schema.fields) check(f, doc[f.name], f.name, f.group, out)
  return out
}
