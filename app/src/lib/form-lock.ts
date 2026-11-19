// A document form that is shown but not to be edited: the Published view, a history revision,
// a deleted document, a scheduled one, or a seat that can't write. The form draws disabled
// (DocumentPane's fieldset and FormDisabledContext), and its one edit function refuses too, so
// nothing reached some other way (a dialog drawn outside the fieldset, a paste key, a canvas)
// writes a draft from a read-only view. Publish, Discard and Restore are document actions, not
// form edits: they don't pass here.
import type {Field, Schema} from './data'
import {fieldState, pathReadOnly, type FieldConditions, type Person} from './conditions.ts'
import type {FieldLock} from './doc-lock.ts'

export type FormState = {published: boolean; revision: boolean; gone: boolean; scheduled: boolean; canWrite: boolean}

export const formLocked = (s: FormState) => s.published || s.revision || s.gone || s.scheduled || !s.canWrite

/** What the canvas writes, to judge it by, with the person (lib/conditions.ts Person, handed on its own): the type, the draft, the config's `form.conditions`. */
export type CanvasBody = {schema: Schema | undefined; doc: Record<string, unknown> | null | undefined; rules: Record<string, FieldConditions> | undefined}

/**
 * The fields the whole-document canvas shows and writes: its layout's, the body regions and
 * the bound field blocks. With no layout (a paper type without one in this workspace) it holds
 * the type's body: its rich-text fields.
 */
export function canvasFields(schema: Schema): Field[] {
  const named = new Set((schema.layout ?? []).map((l) => l.name))
  return schema.fields.filter((f) => (named.size ? named.has(f.name) : f.type === 'richText'))
}

/**
 * The canvas as this person may have it, field by field as the form decides (fieldState):
 * not shown while one of its fields is hidden from them (the canvas cannot leave one out, so
 * the form shows the rest), read-only while one is read-only (it cannot lock one block).
 * Without the type or the draft there is nothing to judge by: read-only.
 */
export function canvasAccess(user: Person, {schema, doc, rules}: CanvasBody): 'hidden' | 'readOnly' | 'editable' {
  if (!schema || !doc) return 'readOnly'
  const states = canvasFields(schema).map((f) => fieldState(schema.name, f, doc, user, rules))
  return states.some((s) => s.hidden) ? 'hidden' : states.some((s) => s.readOnly) ? 'readOnly' : 'editable'
}

/** The whole-document Freeform canvas holds the draft. It is not drawn where the pane shows another
 * version (Published, a history revision) or where it would show a field hidden from this person,
 * and is read-only wherever the form is locked or one of its fields is read-only for this person
 * (canvasAccess): "Edit the body in Freeform" opens it, and it must not change what the form may not. */
export function freeformCanvas(s: FormState, user: Person, body: CanvasBody): 'hidden' | 'readOnly' | 'editable' {
  if (s.published || s.revision) return 'hidden'
  const access = canvasAccess(user, body)
  return access === 'hidden' ? 'hidden' : formLocked(s) ? 'readOnly' : access
}

/**
 * A pane's FieldLock (lib/doc-lock.ts): judged when a write is made, on what `now()` holds
 * then (the type, the doc, the rules, the canvas as freeformCanvas has it), for `user`: a new
 * person makes a new FieldLock.
 * Without the type or the doc nothing can be judged, and the write is refused.
 */
export const paneFieldLock = (now: () => CanvasBody & {canvas: ReturnType<typeof freeformCanvas>}, user: Person, refused: (path: string) => void): FieldLock => ({
  readOnly: (path) => {
    const {schema, doc, rules} = now()
    return !schema || !doc || pathReadOnly(schema.name, schema.fields, doc, user, rules, path)
  },
  get canvas() {
    return now().canvas !== 'editable'
  },
  refused,
})

/** `edit`, refused (false, nothing written) while `locked()` says so when it is called. */
export const unlessLocked =
  <A extends unknown[], R>(locked: () => boolean, edit: (...a: A) => R) =>
  (...a: A): R | false =>
    locked() ? false : edit(...a)
