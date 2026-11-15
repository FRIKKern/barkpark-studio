// Document translations, after Sanity's @sanity/document-internationalization: one document
// per language, linked by ONE `translation.metadata` document per group. The pure parts
// (the schema option, the stored shape, the writes as mutation lists); lib/translations.ts
// reads and sends them. The stored shape is the plugin's own, so a Sanity dataset's groups
// open here linked, and ours open there:
//   {_type: 'translation.metadata', schemaTypes: ['post'], translations: [
//     {_key, _type: 'internationalizedArrayReferenceValue', language: 'en',
//      value: {_type: 'reference', _ref: <id>, _weak: true, _strengthenOnPublish: {type: 'post'}}}]}
// (the plugin before v4 kept the language in `_key`; both are read, a group keeps its own).

export const METADATA_TYPE = 'translation.metadata'
const REF_TYPE = 'internationalizedArrayReferenceValue'

export type Language = {id: string; title: string}
/** A type's `desk.translations`: its languages, and the field that holds a document's own. */
export type TranslationConfig = {languages: Language[]; languageField: string}
export type TranslationRef = {_key: string; _type?: string; language?: string; value?: {_type?: string; _ref?: string; _weak?: boolean; _strengthenOnPublish?: {type: string}}}
export type Metadata = {_id: string; _rev: string; _createdAt?: string; schemaTypes?: string[]; translations?: TranslationRef[]}
type Json = string | number | boolean | null | Json[] | {[k: string]: Json}

const LANGUAGE_ID = /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * A schema's `desk.translations` (docs/EXTENDING.md): `{languages: [{id, title}], languageField?}`.
 * A language may be written as its id alone. Undefined when it names no usable language, so a
 * misspelled option leaves the type untranslated rather than half on.
 */
export function translationsOf(desk: unknown): TranslationConfig | undefined {
  const raw = (desk as {translations?: {languages?: unknown; languageField?: unknown}} | null | undefined)?.translations
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.languages)) return undefined
  const languages: Language[] = []
  for (const l of raw.languages as unknown[]) {
    const id = typeof l === 'string' ? l : (l as {id?: unknown} | null)?.id
    if (typeof id !== 'string' || !LANGUAGE_ID.test(id) || languages.some((x) => x.id === id)) continue
    const title = typeof l === 'object' && l && typeof (l as {title?: unknown}).title === 'string' ? (l as {title: string}).title.trim() : ''
    languages.push({id, title: title || id})
  }
  if (!languages.length) return undefined
  const field = raw.languageField
  return {languages, languageField: typeof field === 'string' && FIELD_NAME.test(field) ? field : 'language'}
}

/**
 * A schema's fields and its translations option, as the studio reads them: the form never
 * draws the field the feature owns (the header's badge and menu do), declared hidden or not.
 */
export function translatedFields<F extends {name: string}>(fields: F[], desk: unknown): {fields: F[]; translations?: TranslationConfig} {
  const translations = translationsOf(desk)
  return translations ? {fields: fields.map((f) => (f.name === translations.languageField ? {...f, hidden: true} : f)), translations} : {fields}
}

/** A document's own language (its language field), if it holds one. */
export function languageOf(doc: Record<string, unknown> | null | undefined, config: TranslationConfig): string | undefined {
  const v = doc?.[config.languageField]
  return typeof v === 'string' && v ? v : undefined
}

/** A language's name for the editor; one the schema no longer lists reads as its id. */
export const languageTitle = (config: TranslationConfig, id: string) => config.languages.find((l) => l.id === id)?.title ?? id

/** The language an entry stands for: the plugin's `language`, or its `_key` (the plugin before v4). */
export const entryLanguage = (e: TranslationRef) => (typeof e.language === 'string' && e.language ? e.language : e._key)
const entryRef = (e: TranslationRef) => e.value?._ref?.replace(/^drafts\./, '')

/** A group's members, one per language (the first entry wins, as the plugin's menu reads it). */
export function membersOf(meta: Pick<Metadata, 'translations'> | null | undefined): {language: string; id: string}[] {
  const out: {language: string; id: string}[] = []
  for (const e of meta?.translations ?? []) {
    const id = entryRef(e)
    const language = e && entryLanguage(e)
    if (id && language && !out.some((m) => m.language === language)) out.push({language, id})
  }
  return out
}

/** The group a document is in: the metadata document that names it (the oldest, when several do). */
export function groupOf<M extends Metadata>(metas: M[], id: string): M | undefined {
  return metas
    .filter((m) => (m.translations ?? []).some((e) => entryRef(e) === id))
    .sort((a, b) => (a._createdAt ?? '').localeCompare(b._createdAt ?? '') || a._id.localeCompare(b._id))[0]
}

/**
 * A new group's metadata id, from the document it starts at: two browsers that start one
 * group at the same moment write the SAME document, never two (the plugin's random id can).
 */
export const metadataId = (sourceId: string) => `translations-${sourceId}`

/** One translation entry, Sanity's stored shape. `keyed`: a group of the plugin before v4 keeps the language in `_key`. */
export function translationRef(language: string, id: string, type: string, key: string, keyed = false): TranslationRef {
  return {_key: keyed ? language : key, _type: REF_TYPE, ...(keyed ? {} : {language}), value: {_type: 'reference', _ref: id, _weak: true, _strengthenOnPublish: {type}}}
}

/** A translation starts as its source's content (the plugin's default), in its own language. */
export function translationDoc(source: Record<string, unknown>, id: string, type: string, languageField: string, language: string, extra: Record<string, unknown> = {}): Record<string, Json> {
  const fields = Object.fromEntries(Object.entries(source).filter(([k]) => !k.startsWith('_')))
  return {...fields, ...extra, _id: id, _type: type, [languageField]: language} as Record<string, Json>
}

/** Start a group at `sourceId`: its metadata document with that one entry. Sent twice it changes nothing. */
export function seedMutations(metaId: string, sourceId: string, language: string, type: string, key: string): Json[] {
  const doc = {_id: metaId, _type: METADATA_TYPE, schemaTypes: [type], translations: [translationRef(language, sourceId, type, key)]}
  return [{createIfNotExists: doc as unknown as Json}, {publish: {id: metaId, type: METADATA_TYPE}}]
}

const fenced = (meta: Metadata, translations: TranslationRef[]): Json => ({patch: {id: meta._id, type: METADATA_TYPE, ifRevisionID: meta._rev, set: {translations: translations as unknown as Json}}})

/**
 * Link `newId` into the group as `language`, fenced on the metadata's revision: sent in one
 * transaction with the new document's `create`, so a second editor who linked that language
 * first refuses the whole write (412) and nothing is left half-linked. An entry that already
 * stands for `language` is replaced (the caller found its document gone); the source's own
 * entry is put back when the group lost it.
 */
export function linkMutations(meta: Metadata, source: {id: string; language: string}, added: {id: string; language: string}, type: string, keys: [string, string]): Json[] {
  const keyed = (meta.translations ?? []).length > 0 && (meta.translations ?? []).every((e) => typeof e.language !== 'string')
  let next = (meta.translations ?? []).filter((e) => entryLanguage(e) !== added.language)
  if (!next.some((e) => entryRef(e) === source.id)) next = [...next.filter((e) => entryLanguage(e) !== source.language), translationRef(source.language, source.id, type, keys[0], keyed)]
  next = [...next, translationRef(added.language, added.id, type, keys[1], keyed)]
  return [fenced(meta, next), {publish: {id: meta._id, type: METADATA_TYPE}}]
}

/**
 * Take `id` out of its group, fenced likewise. A group left with one member (or none) is no
 * group: its metadata document goes too. Null when the group does not name `id`.
 */
export function unlinkMutations(meta: Metadata, id: string): Json[] | null {
  const all = meta.translations ?? []
  const next = all.filter((e) => entryRef(e) !== id)
  if (next.length === all.length) return null
  if (next.length <= 1) return [fenced(meta, next), {delete: {id: meta._id, type: METADATA_TYPE}}]
  return [fenced(meta, next), {publish: {id: meta._id, type: METADATA_TYPE}}]
}

/** A refused write that another editor's write explains (a stale fence, a taken id): read again and decide again. */
export const lostRace = (message: string) => /\bmutate (412|409)\b/.test(message)
