// A document form that is shown but not to be edited: the Published view, a history revision,
// a deleted document, a scheduled one, or a seat that can't write. The form draws disabled
// (DocumentPane's fieldset and FormDisabledContext), and its one edit function refuses too, so
// nothing reached some other way (a dialog drawn outside the fieldset, a paste key, a canvas)
// writes a draft from a read-only view. Publish, Discard and Restore are document actions, not
// form edits: they don't pass here.
import type {Schema} from './data'
import {fieldState, type CurrentUser, type FieldConditions} from './conditions.ts'

export type FormState = {published: boolean; revision: boolean; gone: boolean; scheduled: boolean; canWrite: boolean}

export const formLocked = (s: FormState) => s.published || s.revision || s.gone || s.scheduled || !s.canWrite

/** What the canvas writes, to judge its body by: the type, the draft, who is signed in, the config's `form.conditions`. */
export type CanvasBody = {schema: Schema | undefined; doc: Record<string, unknown> | undefined; user: CurrentUser | null; rules: Record<string, FieldConditions> | undefined}

/** A body region of the type's layout (a richText field the canvas writes) read-only for this person, as the form decides it (fieldState). */
export const bodyReadOnly = ({schema, doc, user, rules}: CanvasBody) =>
  !!schema && !!doc && (schema.layout ?? []).some((l) => l.kind === 'region' && schema.fields.some((f) => f.name === l.name && fieldState(schema.name, f, doc, user, rules).readOnly))

/** The whole-document Freeform canvas holds the draft. It is not drawn where the pane shows another
 * version (Published, a history revision) and is read-only wherever the form is locked, and while
 * its body is read-only for this person (the schema's `readOnly` or a `form.conditions` one): "Edit
 * the body in Freeform" opens it, and it must not change what the form may not. */
export const freeformCanvas = (s: FormState, body?: CanvasBody): 'hidden' | 'readOnly' | 'editable' =>
  s.published || s.revision ? 'hidden' : formLocked(s) || (!!body && bodyReadOnly(body)) ? 'readOnly' : 'editable'

/** `edit`, refused (false, nothing written) while `locked()` says so when it is called. */
export const unlessLocked =
  <A extends unknown[], R>(locked: () => boolean, edit: (...a: A) => R) =>
  (...a: A): R | false =>
    locked() ? false : edit(...a)
