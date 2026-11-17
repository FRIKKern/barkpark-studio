// Sanity's `deprecated: {reason}` on a field or a type (task-f47e461e674dc638), as Sanity 6.17
// draws it: a deprecated field keeps its input and its value (Sanity makes it neither read-only
// nor hidden), with a caution "deprecated" badge after its title and the reason in caution
// text under it (FormFieldHeaderText, FormFieldSet). A deprecated block or inline object type
// stays in the Portable Text insert menu, disabled, its reason the tooltip (PortableText
// toolbar InsertMenu); the array insert menu does the same here. Barkpark keeps the key on a
// field, an array member and a block type as given (a schema_unknown_key advisory: it never
// reads it). A deprecated document type is not here: Barkpark drops schema-level keys.
import type {Field} from './data'

/** The reason a field, an array member or a Portable Text type is deprecated ('' with none given); undefined when it isn't. */
export function deprecatedReason(x: unknown): string | undefined {
  const d = x && typeof x === 'object' ? (x as {deprecated?: unknown}).deprecated : undefined
  if (!d || typeof d !== 'object') return undefined
  const reason = (d as {reason?: unknown}).reason
  return typeof reason === 'string' ? reason : ''
}

/** The id of a field's reason line, for its control's aria-describedby (lib/field-aria.ts). */
export const deprecatedId = (path: string) => `${path}-deprecated`

/**
 * An insert menu item for a type, as Sanity draws a deprecated one: there, disabled, the reason
 * as its tooltip. aria-disabled, not disabled: the pointer and the arrow keys still reach it, so
 * the reason shows on hover and on keyboard focus (components/Tip.tsx); a pick does nothing.
 */
export function insertItemProps(reason: string | undefined): {'aria-disabled'?: true; 'data-tip'?: string; 'data-deprecated'?: ''} {
  return reason === undefined ? {} : {'aria-disabled': true, 'data-tip': reason || undefined, 'data-deprecated': ''}
}

/** The first type a menu may add (Enter in its search box): a deprecated one is skipped. */
export const firstPickable = <T extends {deprecated?: string}>(choices: T[]): T | undefined => choices.find((c) => c.deprecated === undefined)

/** The reason a Portable Text field's declared block (`blocks.of`) or inline object (`blocks.inline`) type is deprecated. */
export function ptDeprecated(field: Pick<Field, 'blocks'>, kind: 'block' | 'inline', name: string): string | undefined {
  const list = field.blocks?.[kind === 'block' ? 'of' : 'inline']
  const entry = Array.isArray(list) ? list.find((e) => !!e && typeof e === 'object' && (e as {name?: unknown}).name === name) : undefined
  return deprecatedReason(entry)
}
