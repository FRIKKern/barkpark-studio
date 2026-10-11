import type {QueryClient} from '@tanstack/react-query'
import {schemaOf, type Schema} from './data'
import {createDoc, draftNew} from './edits'
import {editorMode} from './editor-mode'
import studio from '../studio.config'

// J18, Sanity's initial value templates: each type starts the one way its schema says
// (its initial values), and the studio config can add more (`templates`). Every Create
// new offers them all: the navbar "+", a list's "+" (a menu once there are several)
// and a reference field's Create.

export type Choice = {id: string; title: string; type: string; value: Record<string, unknown>}

/** The ways to start `type`: its own first, then the config's templates for it, in config order. */
export function choicesFor(schemas: Schema[], type: string): Choice[] {
  const schema = schemaOf(schemas, type)
  const own: Choice = {id: type, title: schema?.title ?? type, type, value: schema?.initialValues ?? {}}
  // A template with parameters waits for a structure item that passes them (templateChoice).
  const plain = (studio.templates ?? []).flatMap((t) => (t.schemaType === type && !t.parameters ? [{id: t.id, title: t.title, type, value: t.value}] : []))
  return [own, ...plain]
}

/** A parameterised template with its parameters (a child list's "+", Sanity's S.initialValueTemplateItem). */
export function templateChoice(id: string, params: Record<string, string>): Choice | undefined {
  const t = studio.templates?.find((x) => x.id === id)
  if (!t) return undefined
  return {id: t.id, title: t.title, type: t.schemaType, value: typeof t.value === 'function' ? t.value(params) : t.value}
}

/**
 * Open a new document from `choice` as `id`: it exists only here until its first edit
 * (Sanity's way), except a type with an Expectation (D04), which Barkpark builds at once.
 * `extra` (a reference field's search text as the title) goes on top of the template.
 */
export function startNew(qc: QueryClient, schemas: Schema[], choice: Choice, id: string, extra: Record<string, unknown> = {}): Promise<void> {
  if (editorMode(choice.type, schemaOf(schemas, choice.type)) !== 'none') return createDoc(qc, choice.type, id, {...(choice.id === choice.type ? {} : choice.value), ...extra})
  draftNew(qc, choice.type, id, {...choice.value, ...extra})
  return Promise.resolve()
}
