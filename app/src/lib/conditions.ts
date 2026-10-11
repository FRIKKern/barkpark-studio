import type {Field} from './data'

// Conditional fields (J30). Barkpark's schema says when a field shows with
// `visibleWhen: {field, operator, value}` (api content/field_visibility.ex); these are
// the same operators with the same meaning, so the Studio and Barkpark's own
// validation never disagree. `readOnly` is `true` or the same condition shape:
// Barkpark stores it but has no editor rule for it yet (task-00eac0b023b11517).
// Like Sanity's hidden/readOnly, both are editor behaviour, not access control.
/**
 * `scope` (barkpark#22554, Sanity's `({parent}) => …`): "document" (the default) reads
 * `field` from the document root; "parent" from the object or array item the field sits in.
 */
export type Condition = {field: string; operator: string; value?: unknown; scope?: 'document' | 'parent'}

// Dotted path from the document root; a list on the way fans out over its rows.
function lookup(doc: unknown, path: string[]): unknown {
  if (!path.length) return doc
  if (Array.isArray(doc)) return doc.flatMap((row) => lookup(row, path) as unknown[])
  if (doc && typeof doc === 'object') return lookup((doc as Record<string, unknown>)[path[0]!], path.slice(1))
  return undefined
}

const count = (v: unknown) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : v == null || v === '' ? 0 : 1)
const isEmpty = (v: unknown) => count(v) === 0

export function matches(c: Condition, doc: Record<string, unknown>): boolean {
  const v = lookup(doc, c.field.split('.'))
  switch (c.operator) {
    case 'eq':
      return v === c.value
    case 'neq':
      return v !== c.value
    case 'in':
      return Array.isArray(c.value) && c.value.includes(v)
    case 'empty':
      return isEmpty(v)
    case 'non_empty':
      return !isEmpty(v)
    case 'starts_with':
      return typeof v === 'string' && typeof c.value === 'string' && v.startsWith(c.value)
    case 'count_eq':
      return count(v) === c.value
    case 'count_neq':
      return count(v) !== c.value
    case 'count_gt':
      return count(v) > Number(c.value)
    case 'count_lt':
      return count(v) < Number(c.value)
    default:
      return true // an operator we don't know never hides a field
  }
}

/** What a condition reads from: the enclosing object for scope "parent" (the document when there is none). */
const base = (c: Condition, doc: Record<string, unknown>, parent?: Record<string, unknown>) => (c.scope === 'parent' && parent ? parent : doc)
export const isHidden = (f: Field, doc: Record<string, unknown>, parent?: Record<string, unknown>) => !!f.visibleWhen && !matches(f.visibleWhen, base(f.visibleWhen, doc, parent))
export const isReadOnly = (f: Field, doc: Record<string, unknown>, parent?: Record<string, unknown>) =>
  f.readOnly === true || (typeof f.readOnly === 'object' && f.readOnly !== null && matches(f.readOnly, base(f.readOnly, doc, parent)))
