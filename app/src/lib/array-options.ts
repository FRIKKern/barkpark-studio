// Sanity's array options that decide what an editor may do with the items (sanity 6.17:
// ArrayOfObjectsInput/List/PreviewItem, ArrayOfPrimitivesInput/ItemRow, ReferenceInput/ReferenceItem,
// ArrayOfObjectsFunctions, studio/inputResolver/fieldResolver; ArrayOptions in @sanity/types):
//
// - disableActions: ['add' | 'addBefore' | 'addAfter' | 'remove' | 'duplicate' | 'copy'] takes
//   exactly those away. 'add' takes Add item, both inserts of the item menu and the field's Paste;
//   'copy' the item's Copy and the field's Copy field. An item menu left with nothing is not drawn.
// - sortable: false draws no drag handles, so no item moves by pointer or keyboard.
// - modal: {type: 'dialog' | 'popover', width} opens an object item in a dialog (the default) or in
//   a popover by its row, `width` one of Sanity UI's container sizes (default 1).
// components/SortableRows.tsx, ItemPopover.tsx and Fields.tsx (Copy and Paste field) read these.

export type ArrayAction = 'add' | 'addBefore' | 'addAfter' | 'remove' | 'duplicate' | 'copy'
/** What the array lets an editor do; `paste` is the field's Paste field. */
export type Allowed = Record<ArrayAction | 'paste', boolean>
/** An item "…" menu entry, in Sanity's order. */
export type ItemEntry = 'remove' | 'copy' | 'duplicate' | 'addBefore' | 'addAfter'
type Width = number | 'auto' | (number | 'auto')[]
export type Modal = {type: 'dialog' | 'popover'; width: Width}

const own = (options: unknown): Record<string, unknown> => (options && typeof options === 'object' && !Array.isArray(options) ? (options as Record<string, unknown>) : {})

export function actions(options: unknown): Allowed {
  const list = own(options).disableActions
  const off = new Set(Array.isArray(list) ? list.filter((a) => typeof a === 'string') : [])
  return {
    add: !off.has('add'),
    addBefore: !off.has('add') && !off.has('addBefore'),
    addAfter: !off.has('add') && !off.has('addAfter'),
    remove: !off.has('remove'),
    duplicate: !off.has('duplicate'),
    copy: !off.has('copy'),
    paste: !off.has('add'),
  }
}

/** Sanity's `options.sortable !== false`. */
export const sortable = (options: unknown) => own(options).sortable !== false

/**
 * What an array's rows draw: the drag handle, the item menu's entries and the Add item button.
 * `canCopy`: the array copies items at all. `copy`: Cmd/Ctrl+C on a row copies it.
 */
export function rowParts(options: unknown, canCopy: boolean): {handle: boolean; menu: ItemEntry[]; add: boolean; copy: boolean} {
  const a = actions(options)
  const copy = canCopy && a.copy
  const menu: ItemEntry[] = [...(a.remove ? ['remove' as const] : []), ...(copy ? ['copy' as const] : []), ...(a.duplicate ? ['duplicate' as const] : []), ...(a.addBefore ? ['addBefore' as const] : []), ...(a.addAfter ? ['addAfter' as const] : [])]
  return {handle: sortable(options), menu, add: a.add, copy}
}

const isWidth = (w: unknown) => w === 'auto' || (typeof w === 'number' && Number.isInteger(w) && w >= 0 && w < CONTAINERS.length)

/** Sanity's `type={modal?.type || 'dialog'}` and `width={modal?.width ?? 1}`. */
export function modalOf(options: unknown): Modal {
  const m = own(own(options).modal)
  const width = Array.isArray(m.width) ? (m.width.filter(isWidth) as Width) : isWidth(m.width) ? (m.width as Width) : 1
  return {type: m.type === 'popover' ? 'popover' : 'dialog', width: Array.isArray(width) && !width.length ? 1 : width}
}

/** Sanity UI's container sizes (theme.sanity.container) and media breakpoints, in px. */
const CONTAINERS = [320, 640, 960, 1280, 1600, 1920]
const MEDIA = [360, 600, 900, 1200, 1800, 2400]

/**
 * A modal width in px at this viewport width, or null for 'auto' (as wide as its content). A list
 * is responsive as Sanity UI's: the first value, then each next one from the next breakpoint up.
 */
export function modalWidth(width: unknown, viewport: number): number | null {
  const list = (Array.isArray(width) ? width : [width]).map((w) => (isWidth(w) ? w : 1))
  let i = 0
  while (i + 1 < list.length && viewport >= MEDIA[i]!) i++
  const w = list[i] ?? 1
  return w === 'auto' ? null : CONTAINERS[w as number]!
}

type Box = {left: number; top: number; width: number; height: number}
/** Sanity's popover: 4 px from its row, 4 px inside its boundary. */
const GAP = 4
const PAD = 4

/**
 * Where an item popover goes, in its host's coordinates (both boxes in the viewport's): under its
 * row and centred on it (Sanity's placement 'bottom'), flipped above when it fits only there or
 * there is more room there, shifted to stay inside, as wide as asked or the host allows (constrainSize).
 */
export function placePopover(row: Box, host: Box, width: number, height: number) {
  const w = Math.max(0, Math.min(width, host.width - 2 * PAD))
  const below = host.top + host.height - PAD - (row.top + row.height + GAP)
  const above = row.top - GAP - (host.top + PAD)
  const side: 'bottom' | 'top' = height <= below || (height > above && below >= above) ? 'bottom' : 'top'
  const room = Math.max(0, side === 'bottom' ? below : above)
  const top = side === 'bottom' ? row.top + row.height + GAP - host.top : row.top - GAP - Math.min(height, room) - host.top
  const centre = row.left + row.width / 2 - host.left
  const left = Math.round(Math.max(PAD, Math.min(centre - w / 2, host.width - PAD - w)))
  return {left, top: Math.round(top), width: Math.round(w), maxHeight: Math.round(room), side}
}
