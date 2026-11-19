// Sanity's array at its maximum (sanity 6.17: arrays/common/ArrayValidationContext,
// ArrayOfObjectsFunctions, ArrayOfPrimitivesFunctions, List/PreviewItem, Grid/GridItem, ItemRow,
// ReferenceItem): with Rule.max(n) and n items or more, Add item and the item menu's Add item
// before/after are unavailable, "Maximum items reached". Ours takes Duplicate away too, and refuses
// a paste or a file drop that would add past the max, with the same words. Nothing is removed from
// an array already past its max (imported data); its validation says so as before (lib/validation.ts).

export const MAX_REACHED = 'Maximum items reached'

const rulesOf = (validation: unknown): Record<string, unknown>[] =>
  (Array.isArray(validation) ? validation : validation ? [validation] : []).filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')

/** Sanity's getValidationRule(type, 'max'): the first rule's max, at any level (a warning's too). */
export function maxItems(validation: unknown): number | undefined {
  for (const r of rulesOf(validation)) if (typeof r.max === 'number' && Number.isFinite(r.max)) return r.max
  return undefined
}

/** Is an array with this many items at its max (or past it)? Then nothing more may be added. */
export function atMax(max: number | undefined, count: number): boolean {
  return max !== undefined && count >= max
}

/** How many more items fit (Infinity with no max, 0 at or past it): a drop of files takes only these. */
export function room(field: {validation?: unknown}, items: unknown): number {
  const max = maxItems(field.validation)
  return max === undefined ? Infinity : Math.max(0, max - (Array.isArray(items) ? items.length : 0))
}

type PasteField = {type?: string; validation?: unknown; options?: unknown}

/**
 * May this paste (Paste field, Cmd/Ctrl+V) land in the field? An array of items may not end longer than
 * its max and longer than it was: an item appended at the max is refused, while a paste that replaces
 * the array with one at or under the max (or a shorter over-full one) is fine. The tags layout and an
 * options.list checkbox list are left out, as Sanity leaves them out of the max.
 */
export function pasteAllowed(field: PasteField, before: unknown, after: unknown): boolean {
  const options = field.options && !Array.isArray(field.options) ? (field.options as {layout?: unknown; list?: unknown}) : {}
  if (field.type !== 'arrayOf' || options.layout === 'tags' || Array.isArray(options.list)) return true
  const max = maxItems(field.validation)
  if (max === undefined || !Array.isArray(after)) return true
  return !(after.length > max && after.length > (Array.isArray(before) ? before.length : 0))
}
