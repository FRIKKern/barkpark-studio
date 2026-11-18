// Sanity's array at its maximum (sanity 6.17: arrays/common/ArrayValidationContext,
// ArrayOfObjectsFunctions, ArrayOfPrimitivesFunctions, List/PreviewItem, Grid/GridItem, ItemRow,
// ReferenceItem): with Rule.max(n) and n items or more, Add item and the item menu's Add item
// before/after are unavailable, "Maximum items reached". Ours takes Duplicate, Paste field and a
// file drop away too: each adds an item. Nothing is removed from an array already past its max
// (imported data); its validation says so as before (lib/validation.ts).

export const MAX_REACHED = 'Maximum items reached'

const rulesOf = (validation: unknown): Record<string, unknown>[] =>
  (Array.isArray(validation) ? validation : validation ? [validation] : []).filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')

/** Sanity's getValidationRule(type, 'max'): the first rule's max, at any level (a warning's too). */
export function maxItems(validation: unknown): number | undefined {
  for (const r of rulesOf(validation)) if (typeof r.max === 'number' && Number.isFinite(r.max)) return r.max
  return undefined
}

export type CanAdd = {ok: true} | {ok: false; reason: typeof MAX_REACHED}

/** May one more item go into this array? Not when it holds its max or more. */
export function canAdd(field: {validation?: unknown}, items: unknown): CanAdd {
  const max = maxItems(field.validation)
  const count = Array.isArray(items) ? items.length : 0
  return max !== undefined && count >= max ? {ok: false, reason: MAX_REACHED} : {ok: true}
}

/** How many more items fit (Infinity with no max, 0 at or past it): a drop of files takes only these. */
export function room(field: {validation?: unknown}, items: unknown): number {
  const max = maxItems(field.validation)
  return max === undefined ? Infinity : Math.max(0, max - (Array.isArray(items) ? items.length : 0))
}

/**
 * A paste into an array (Paste field, Cmd/Ctrl+V): refused when it would leave the array longer than
 * its max and longer than it is. A paste that replaces a long array with a shorter one is fine.
 */
export function pasteRefused(field: {validation?: unknown}, before: unknown, after: unknown): boolean {
  const max = maxItems(field.validation)
  if (max === undefined || !Array.isArray(after)) return false
  return after.length > max && after.length > (Array.isArray(before) ? before.length : 0)
}
