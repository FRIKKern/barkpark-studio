import type {QueryClient} from '@tanstack/react-query'
import {schemaOf, type Schema} from './data'
import {createDoc, draftNew} from './edits'
import {editorMode} from './editor-mode'
import studio from '../studio.config'
import {resolveTemplate} from './template-resolve'

// J18, Sanity's initial value templates: each type starts the one way its schema says
// (its initial values), and the studio config can add more (`templates`). Every Create
// new offers them all: the navbar "+", a list's "+" (a menu once there are several)
// and a reference field's Create.

export type Choice = {id: string; title: string; type: string; value: Record<string, unknown>; params?: Record<string, string>}

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
  return {id: t.id, title: t.title, type: t.schemaType, value: typeof t.value === 'function' ? t.value(params) : t.value, params}
}

/** A template named by a URL (a new doc's `template=`, an intent link), checked as user input (lib/template-resolve). */
export function choiceById(schemas: Schema[], type: string, id: string, params?: Record<string, string>): Choice | undefined {
  return resolveTemplate(studio.templates ?? [], (t) => {
    const schema = schemaOf(schemas, t)
    return schema && {title: schema.title ?? t, value: schema.initialValues ?? {}}
  }, type, id, params)
}

/**
 * Open a new document from `choice` as `id`: it exists only here until its first edit
 * (Sanity's way), except a type with an Expectation (D04), which Barkpark builds at once.
 * `extra` (a reference field's search text as the title) goes on top of the template.
 * draftNew and createDoc resolve "$today" in either (lib/today-start): the type's own
 * values are the schema's, Barkpark's too; a template's and `extra` exist only here.
 */
export function startNew(qc: QueryClient, schemas: Schema[], choice: Choice, id: string, extra: Record<string, unknown> = {}): Promise<void> {
  const own = choice.id === choice.type
  const local = {...(own ? {} : choice.value), ...extra}
  if (editorMode(choice.type, schemaOf(schemas, choice.type)) !== 'none') return createDoc(qc, choice.type, id, {local})
  draftNew(qc, choice.type, id, {schema: own ? choice.value : {}, local})
  return Promise.resolve()
}

/**
 * A listed fixed page with no document yet (task-b3f4ccc4f9cfe129): opened as the + button
 * opens its type, through the type's own choice, so its create sends the same body.
 */
export function startFixed(qc: QueryClient, schemas: Schema[], type: string, id: string): Promise<void> {
  return startNew(qc, schemas, choicesFor(schemas, type)[0]!, id)
}
