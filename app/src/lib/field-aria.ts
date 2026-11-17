// scout-6: what a field's control tells a screen reader, from the field's own state. Fields.tsx
// draws the problem mark and the description with these ids, and sets these attributes on the
// control, so the description a reader hears is the one drawn.
import {deprecatedIds, deprecatedReason} from './deprecated.ts'

export const problemId = (path: string) => `${path}-problem`
export const descId = (path: string) => `${path}-desc`

/** aria-describedby (the problem, a deprecated field's badge and reason, then the schema description) and aria-invalid; undefined = none. */
export function fieldAria(path: string, field: {description?: unknown; deprecated?: unknown}, invalid: boolean) {
  const by = [invalid && problemId(path), ...deprecatedIds(path, deprecatedReason(field)), typeof field.description === 'string' && field.description && descId(path)].filter(Boolean).join(' ')
  return {'aria-describedby': by || undefined, 'aria-invalid': invalid ? ('true' as const) : undefined}
}
