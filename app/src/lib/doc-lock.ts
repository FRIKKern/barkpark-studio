// The write side of the form lock (lib/form-lock.ts). Each document pane says whether its form
// is locked for the doc it shows, and which of its fields this person may not change by hand (the
// one rule, lib/conditions.ts fieldState). A doc is locked when every pane showing it is locked; a
// field likewise. Where an edit by hand is written, this is checked when it is called:
// edits.edit() for the form's fields (the doc and the field written), "Keep mine" on a clash
// (edits.settleClash), and the Freeform/Body canvas's block batch (PortableDocEditor: the doc, its
// field canvas's field, or the whole-document canvas). So a locked pane, or a field read-only for
// this person, refuses there whatever led to the edit: a key, a menu, a replay of kept edits, an
// undo, a card's button. A refused field write is said (the pane names the field); a canvas batch
// keeps its words with the reason.
// A document action's `set` (edits.setByAction) is code the developer wrote, not an edit by hand:
// it keeps the document lock only, and writes a field the form shows read-only, as Sanity's
// patch.execute does. A doc no pane shows (a list's bulk action, the Presentation page) is not
// locked here; those callers judge for themselves. Publish, Discard, Unpublish, Restore, Revert,
// Pause to edit, Duplicate and Delete do not come here. Nor do the server's own frames (another
// editor's write, a rebase onto it): only this person's edits are judged.

/** What a pane says of the fields of the doc it shows, for this person, read when a write is made. */
export type FieldLock = {
  /** A write to `path` (a field, or a path into one) this person may not make (conditions.ts pathReadOnly). */
  readOnly: (path: string) => boolean
  /** The whole-document canvas may not be written: one of its fields is read-only or hidden for this person (form-lock.ts canvasAccess). */
  canvas: boolean
  /** Told when a write to `path` is refused here, to say so. */
  refused: (path: string) => void
}
type Shown = {locked: boolean; fields?: FieldLock}

const shown = new Map<string, Map<object, Shown>>()

/** `pane` (any object that stays the same while the pane is mounted) shows `id`, locked or not, and judges its fields with `fields`. */
export function showDoc(id: string, pane: object, locked: boolean, fields?: FieldLock) {
  const panes = shown.get(id) ?? new Map<object, Shown>()
  shown.set(id, panes.set(pane, {locked, fields}))
}

export function hideDoc(id: string, pane: object) {
  const panes = shown.get(id)
  if (panes?.delete(pane) && !panes.size) shown.delete(id)
}

const every = (id: string, refuses: (s: Shown) => boolean) => {
  const panes = shown.get(id)
  return !!panes && [...panes.values()].every(refuses)
}

/** Read when the write is made, not when the function that makes it was. */
export const docLocked = (id: string): boolean => every(id, (s) => s.locked)

/** A write to `path` in `id`: refused while every pane showing the doc is locked or says this person may not make it. */
export const fieldLocked = (id: string, path: string): boolean => every(id, (s) => s.locked || !!s.fields?.readOnly(path))

/** A canvas batch on `id`: a field canvas's (`field`) as a write to that field, the whole-document canvas's as its fields say. */
export const canvasLocked = (id: string, field?: string): boolean => (field ? fieldLocked(id, field) : every(id, (s) => s.locked || !!s.fields?.canvas))

/** A write by hand to `path` in `id` this person may not make: true, and the pane is told so it can say it. */
export function fieldRefused(id: string, path: string): boolean {
  if (!fieldLocked(id, path)) return false
  ;[...(shown.get(id)?.values() ?? [])].find((s) => s.fields)?.fields!.refused(path)
  return true
}

/**
 * `write`, refused (false, nothing written) while the doc it writes (`idOf` its arguments) is
 * locked when it is called; with `pathOf` (an edit by hand), also while the field it writes is
 * read-only for this person there (fieldRefused). A caller reads the false before it says the
 * write was made.
 */
export const unlessDocLocked =
  <A extends unknown[], R>(idOf: (args: NoInfer<A>) => string, write: (...a: A) => R, pathOf?: (args: NoInfer<A>) => string) =>
  (...a: A): R | false => {
    const id = idOf(a)
    if (docLocked(id)) return false
    const path = pathOf?.(a)
    if (path !== undefined && fieldRefused(id, path)) return false
    return write(...a)
  }
