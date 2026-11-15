import {queryOptions, type QueryClient} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset} from '../server/barkpark'
import type {Doc} from './data'
import {deleteDoc, flush, mutate, whenSaved} from './edits'
import {METADATA_TYPE, groupOf, languageOf, linkMutations, lostRace, membersOf, metadataId, seedMutations, translationDoc, unlinkMutations, type Metadata, type TranslationConfig} from './translation-group'

// Document translations (lib/translation-group.ts has the shape and the writes). A group's
// links live in one `translation.metadata` document, schemaless here as the studio's tasks
// and comments are (Barkpark stores it, draws no edges from it, so it never blocks a delete),
// read by Sanity's own query and written in one transaction with the document it links.

type Json = string | number | boolean | null | Json[] | {[k: string]: Json}

/** What the menu reads: the metadata documents that name `id`, and which of their members still exist. */
export type Group = {metas: Metadata[]; alive: string[]}

async function groq<T>(query: string, params: Record<string, unknown>, perspective: 'published' | 'raw', fresh: boolean): Promise<T> {
  const qs = new URLSearchParams({query, perspective})
  for (const [k, v] of Object.entries(params)) qs.set(`$${k}`, JSON.stringify(v))
  const res = await bpFetch(`/v2025-02-19/data/query/${dataset()}?${qs}`, {}, undefined, {fresh})
  if (!res.ok) throw new Error(`Could not read the translations (${res.status})`)
  return ((await res.json()) as {result: T}).result
}

const fetchGroup = createServerFn({method: 'GET'})
  .validator((d: {id: string; fresh?: boolean}) => d)
  .handler(async ({data}) => {
    // The plugin's own lookup (its useTranslationMetadata).
    const metas = await groq<Metadata[]>('*[_type == $type && $id in translations[].value._ref]', {type: METADATA_TYPE, id: data.id}, 'published', !!data.fresh)
    const ids = [...new Set(metas.flatMap((m) => membersOf(m).map((x) => x.id)))]
    // A member deleted from outside (the API, another studio) leaves its entry behind: only
    // the ones that still exist, as a draft or published, are translations.
    const found = ids.length ? await groq<{_id: string}[]>('*[_id in $ids]{_id}', {ids: ids.flatMap((id) => [id, `drafts.${id}`])}, 'raw', !!data.fresh) : []
    return {metas, alive: [...new Set(found.map((d) => d._id.replace(/^drafts\./, '')))]} as unknown as Json
  })

const readGroup = async (id: string, fresh = false) => (await fetchGroup({data: {id, fresh}})) as unknown as Group

/** The translation group of `id`, kept live by the menu (a metadata or member frame reads it again, lib/live.ts). */
export const groupQuery = (id: string) => queryOptions({queryKey: ['translations', id], staleTime: 10_000, queryFn: () => readGroup(id)})

/** The languages of `id`'s group that have a living document: `{language: id}`. */
export function translationsIn(group: Group | undefined, id: string): Record<string, string> {
  const meta = group && groupOf(group.metas, id)
  return Object.fromEntries(membersOf(meta).filter((m) => m.id === id || group!.alive.includes(m.id)).map((m) => [m.language, m.id]))
}

const key = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12)
const TRIES = 4

/**
 * Create the `language` translation of `source` and link it, or find the one another editor
 * made first. One transaction holds the new document and its link (fenced on the metadata's
 * revision), so a refused or failed write leaves neither. Two editors creating the same
 * language at once: one write lands, the other is refused, reads again and gets the first's
 * document (`created: false`).
 */
export async function createTranslation(qc: QueryClient, source: Doc, config: TranslationConfig, language: string, extra: Record<string, unknown> = {}): Promise<{id: string; created: boolean}> {
  const id = source._publishedId
  // What the editor sees is what is copied: unsent edits go first.
  flush(qc, id)
  await whenSaved(id)
  const now = qc.getQueryData<Doc>(['doc', id]) ?? source
  const from = languageOf(now, config)
  if (!from || !now._rev) throw new Error('Choose a language for this document first')
  for (let attempt = 0; attempt < TRIES; attempt++) {
    let group = await readGroup(id, true)
    let meta = groupOf(group.metas, id)
    if (!meta) {
      // No group yet: start it at this document, under the id every browser derives. Should
      // that id be another group's leftover, a random one (the plugin's way).
      for (const metaId of [metadataId(id), crypto.randomUUID()]) {
        await mutate({data: {mutations: seedMutations(metaId, id, from, now._type, key())}}).catch((err) => {
          if (!lostRace((err as Error).message)) throw err
        })
        group = await readGroup(id, true)
        meta = groupOf(group.metas, id)
        if (meta) break
      }
      if (!meta) continue
    }
    const taken = translationsIn(group, id)[language]
    if (taken) return {id: taken, created: false}
    const newId = crypto.randomUUID()
    const doc = translationDoc(now, newId, now._type, config.languageField, language, extra)
    try {
      const r = (await mutate({data: {mutations: [{create: doc}, ...linkMutations(meta, {id, language: from}, {id: newId, language}, now._type, [key(), key()])]}})) as {results: {document: Doc}[]}
      // The pane that opens on it draws at once; the server's frame replaces this.
      qc.setQueryData(['doc', newId], {...r.results[0]!.document, _hasPublished: false})
      void qc.invalidateQueries({queryKey: ['translations']})
      void qc.invalidateQueries({queryKey: ['list', now._type]})
      return {id: newId, created: true}
    } catch (err) {
      if (!lostRace((err as Error).message)) throw err
    }
  }
  throw new Error('The translations changed while this one was being created. Try again.')
}

/** Take `id` out of its translation group (its document stays). True when a link was removed. */
export async function unlinkTranslation(qc: QueryClient, id: string): Promise<boolean> {
  let removed = false
  for (let attempt = 0; attempt < TRIES; attempt++) {
    const {metas} = await readGroup(id, true)
    const writes = metas.flatMap((m) => unlinkMutations(m, id) ?? [])
    if (!writes.length) break
    try {
      await mutate({data: {mutations: writes}})
      removed = true
      break
    } catch (err) {
      if (!lostRace((err as Error).message) || attempt === TRIES - 1) throw err
    }
  }
  void qc.invalidateQueries({queryKey: ['translations']})
  return removed
}

/**
 * Delete a document that may be a translation: the document, then its link. The link going
 * second loses nothing if it fails: an entry whose document is gone reads as "not translated
 * yet" and the next create replaces it. Where Barkpark does count the metadata's reference
 * (a dataset that declares the type), the delete is refused as referenced: the link goes
 * first then, as the plugin's own "Delete translation" does, and the delete is asked again.
 */
export async function deleteTranslated(qc: QueryClient, doc: Doc, translated: boolean) {
  if (!translated) return deleteDoc(qc, doc)
  try {
    await deleteDoc(qc, doc)
  } catch (err) {
    if (!(err as Error).message.includes('document_referenced') || !(await unlinkTranslation(qc, doc._publishedId))) throw err
    return deleteDoc(qc, doc)
  }
  await unlinkTranslation(qc, doc._publishedId).catch(() => false)
}
