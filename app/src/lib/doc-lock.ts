// The write side of the form lock (lib/form-lock.ts). Each document pane says whether its form
// is locked for the doc it shows. A doc is locked when every pane showing it is locked.
// The two places a form or canvas edit is written check this when they are called:
// edits.edit() for the form's fields, and the Freeform/Body canvas's block batch
// (PortableDocEditor). So a locked pane refuses there whatever led to the write: a key, a
// menu, a replay of kept edits, a card's button.
// A doc no pane shows (a list's bulk action, the Presentation page) is not locked here. Those
// callers judge for themselves. Document actions (Publish, Discard, Unpublish, Restore, Revert,
// Pause to edit, Duplicate, Delete) are not form edits and do not come here.

const shown = new Map<string, Map<object, boolean>>()

/** `pane` (any object that stays the same while the pane is mounted) shows `id`, locked or not. */
export function showDoc(id: string, pane: object, locked: boolean) {
  const panes = shown.get(id) ?? new Map<object, boolean>()
  shown.set(id, panes.set(pane, locked))
}

export function hideDoc(id: string, pane: object) {
  const panes = shown.get(id)
  if (panes?.delete(pane) && !panes.size) shown.delete(id)
}

/** Read when the write is made, not when the function that makes it was. */
export function docLocked(id: string): boolean {
  const panes = shown.get(id)
  return !!panes && [...panes.values()].every(Boolean)
}

/** `write`, refused (false, nothing written) while the doc it writes (`idOf` its arguments) is locked when it is called. */
export const unlessDocLocked =
  <A extends unknown[], R>(idOf: (args: NoInfer<A>) => string, write: (...a: A) => R) =>
  (...a: A): R | false =>
    docLocked(idOf(a)) ? false : write(...a)
