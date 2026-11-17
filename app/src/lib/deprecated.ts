// Sanity's `deprecated: {reason}` on a field or a type (task-f47e461e674dc638), as Sanity 6.17
// draws it: a deprecated field keeps its input and its value (Sanity makes it neither read-only
// nor hidden), with a caution "deprecated" badge after its title and the reason in caution
// text under it (FormFieldHeaderText, FormFieldSet). A deprecated block or inline object type
// stays in the Portable Text insert menu, disabled, its reason the tooltip (PortableText
// toolbar InsertMenu). Sanity's array insert menu offers a deprecated member like any other
// (insert-menu/InsertMenu.tsx reads no `deprecated`), and so does ours. Barkpark keeps the key on a
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

/** What a deprecated field's control is described by: its badge, then its reason (none given: the badge alone). */
export const deprecatedIds = (path: string, reason: string | undefined): string[] => (reason === undefined ? [] : [`${path}-deprecated-label`, ...(reason ? [deprecatedId(path)] : [])])

/**
 * The badge's and the reason's props (components/DeprecatedNote.tsx). Sanity's label holds the
 * title alone, the badge and reason beside it; ours sit inside the label or legend (a boolean's
 * label wraps its input), so they are kept out of the field's name and read as its description.
 */
export const noteParts = (path: string) => ({badge: {id: `${path}-deprecated-label`, 'aria-hidden': true as const}, reason: {id: deprecatedId(path), 'aria-hidden': true as const}})

/**
 * Lists `ids` in the aria-describedby of the control the note's label or legend names: a label's
 * input, a legend's fieldset. A plain field's control gets them from lib/field-aria.ts as well.
 * Returns the undo.
 */
export function describeControl(note: Element, ids: string[]): () => void {
  const host = note.closest('label, legend')
  const control = host?.tagName === 'LEGEND' ? host.parentElement : (host as HTMLLabelElement | null)?.control
  if (!control || !ids.length) return () => {}
  const now = () => (control.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)
  const added = ids.filter((id) => !now().includes(id))
  if (added.length) control.setAttribute('aria-describedby', [...now(), ...added].join(' '))
  return () => {
    const left = now().filter((id) => !added.includes(id))
    if (left.length) control.setAttribute('aria-describedby', left.join(' '))
    else control.removeAttribute('aria-describedby')
  }
}

/**
 * A Portable Text insert for a type, as Sanity's toolbar draws a deprecated one: there,
 * disabled, the reason as its tooltip. aria-disabled, not disabled, so the pointer raises the tooltip
 * (components/Tip.tsx) and a toolbar's Tab still reaches it; a menu's arrow keys pass over it,
 * as Sanity's menus pass a disabled item (lib/focus-scope.ts). A pick does nothing.
 */
export function insertItemProps(reason: string | undefined): {'aria-disabled'?: true; 'data-tip'?: string; 'data-deprecated'?: ''} {
  return reason === undefined ? {} : {'aria-disabled': true, 'data-tip': reason || undefined, 'data-deprecated': ''}
}

/** The reason a Portable Text field's declared block (`blocks.of`) or inline object (`blocks.inline`) type is deprecated. */
export function ptDeprecated(field: Pick<Field, 'blocks'>, kind: 'block' | 'inline', name: string): string | undefined {
  const list = field.blocks?.[kind === 'block' ? 'of' : 'inline']
  const entry = Array.isArray(list) ? list.find((e) => !!e && typeof e === 'object' && (e as {name?: unknown}).name === name) : undefined
  return deprecatedReason(entry)
}
