// A document form that is shown but not to be edited: the Published view, a history revision,
// a deleted document, a scheduled one, or a seat that can't write. The form draws disabled
// (DocumentPane's fieldset and FormDisabledContext), and its one edit function refuses too, so
// nothing reached some other way (a dialog drawn outside the fieldset, a paste key, a canvas)
// writes a draft from a read-only view. Publish, Discard and Restore are document actions, not
// form edits: they don't pass here.

export type FormState = {published: boolean; revision: boolean; gone: boolean; scheduled: boolean; canWrite: boolean}

export const formLocked = (s: FormState) => s.published || s.revision || s.gone || s.scheduled || !s.canWrite

/** The whole-document Freeform canvas holds the draft. It is not drawn where the pane shows another
 * version (Published, a history revision) and is read-only wherever the form is locked. */
export const freeformCanvas = (s: FormState): 'hidden' | 'readOnly' | 'editable' => (s.published || s.revision ? 'hidden' : formLocked(s) ? 'readOnly' : 'editable')

/** `edit`, refused (false, nothing written) while `locked()` says so when it is called. */
export const unlessLocked =
  <A extends unknown[], R>(locked: () => boolean, edit: (...a: A) => R) =>
  (...a: A): R | false =>
    locked() ? false : edit(...a)
