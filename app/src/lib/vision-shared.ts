import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset} from '../server/barkpark'
import {currentEditor} from '../server/auth'

// J37, Vision's shared queries, as Sanity keeps them: documents in the dataset that
// everyone in the workspace sees (Sanity: `vision.sharedQuery`), here of the hidden
// studio type `studioVisionQuery` (fixtures/barkpark-schema, kept out of the desk,
// lists and search like comments and tasks). Personal ones stay in prefs
// (lib/vision-queries.ts). Only the author renames, unshares or deletes one; the author
// is stamped here on the server from the signed-in editor, never sent by the page.

export const SHARED_TYPE = 'studioVisionQuery'

export type SharedQuery = {key: string; title: string; query: string; perspective: string; dataset: string; savedAt: string; author: string | null; mine: boolean}

type Doc = {_id: string; _publishedId?: string; title?: string; query?: string; perspective?: string; dataset?: string; savedAt?: string; authorEmail?: string | null}

async function write(mutations: unknown[]) {
  const res = await bpFetch(`/v1/data/mutate/${dataset()}`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({mutations})})
  if (!res.ok) throw new Error(`Could not save the shared query (${res.status})`)
}

const me = () => currentEditor()?.email ?? null

export const listSharedQueries = createServerFn({method: 'GET'}).handler(async (): Promise<SharedQuery[]> => {
  const res = await bpFetch(`/v1/data/query/${dataset()}/${SHARED_TYPE}?perspective=published&order=savedAt:desc&limit=200`)
  if (!res.ok) throw new Error(`Could not load the shared queries (${res.status})`)
  const docs = ((await res.json()) as {result: {documents: Doc[]}}).result.documents
  return docs.map((d) => ({
    key: d._publishedId ?? d._id,
    title: d.title ?? '',
    query: d.query ?? '',
    perspective: d.perspective ?? 'drafts',
    dataset: d.dataset ?? '',
    savedAt: d.savedAt ?? '',
    author: d.authorEmail ?? null,
    mine: (d.authorEmail ?? null) === me(),
  }))
})

export const shareQuery = createServerFn({method: 'POST'})
  .validator((d: {title: string; query: string; perspective: string; dataset: string}) => d)
  .handler(async ({data}) => {
    const id = `vq-${crypto.randomUUID()}`
    const doc = {_id: id, _type: SHARED_TYPE, title: data.title, query: data.query, perspective: data.perspective, dataset: data.dataset, authorEmail: me(), savedAt: new Date().toISOString()}
    await write([{create: doc}, {publish: {id, type: SHARED_TYPE}}])
    return {key: id}
  })

/** Only the author changes a shared query (Sanity's rule); the server checks. */
async function own(id: string) {
  const res = await bpFetch(`/v1/data/doc/${dataset()}/${SHARED_TYPE}/${encodeURIComponent(id)}?perspective=published`)
  if (!res.ok) throw new Error(`Shared query not found (${res.status})`)
  if ((((await res.json()) as {result: Doc}).result.authorEmail ?? null) !== me()) throw new Error('Only the author can change a shared query.')
}

export const renameSharedQuery = createServerFn({method: 'POST'})
  .validator((d: {key: string; title: string}) => d)
  .handler(async ({data}) => {
    await own(data.key)
    await write([{patch: {id: data.key, type: SHARED_TYPE, set: {title: data.title.trim()}}}, {publish: {id: data.key, type: SHARED_TYPE}}])
    return {ok: true}
  })

/** Unshare (it moves to the author's personal list, page side) or delete: the document goes. */
export const deleteSharedQuery = createServerFn({method: 'POST'})
  .validator((key: string) => key)
  .handler(async ({data}) => {
    await own(data)
    await write([{delete: {id: data, type: SHARED_TYPE, force: true}}])
    return {ok: true}
  })
