import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset} from '../server/barkpark'
import {strengthenUnsets, waitingRefs} from './refs'

// Sanity's strengthen-on-publish (task-288f7978607cdc89). A pick of a never-published document
// is stored weak with `_strengthenOnPublish`; Content Lake makes it strong when the document
// holding it is published. Barkpark does not, so the studio's publish write does it: the
// unsets go in the same request as the publish, one transaction, so a refused or failed
// publish leaves every reference as it was.

/** Which of `ids` have a published version now, asked fresh (never a read shared from before). */
const fetchPublishedIds = createServerFn({method: 'GET'})
  .validator((d: {ids: string[]}) => d)
  .handler(async ({data}) => {
    const qs = new URLSearchParams({query: '*[_id in $ids]._id', perspective: 'raw'})
    qs.set('$ids', JSON.stringify(data.ids))
    const res = await bpFetch(`/v2025-02-19/data/query/${dataset()}?${qs}`, {}, undefined, {fresh: true})
    if (!res.ok) throw new Error(`Barkpark query → ${res.status}`)
    return ((await res.json()) as {result: string[]}).result
  })

/** The patch a publish of `doc` sends first, or none: no reference waits, no read. */
export async function strengthenPatch(doc: Record<string, unknown> & {_publishedId: string; _type: string}): Promise<{patch: {id: string; type: string; unset: string[]}}[]> {
  const waiting = waitingRefs(doc)
  if (!waiting.length) return []
  // A weak field's reference stays weak whatever its target: only the strong ones ask.
  const ids = [...new Set(waiting.filter((r) => !r.weak).map((r) => r.id))]
  const published = new Set(ids.length ? await fetchPublishedIds({data: {ids}}) : [])
  const unset = strengthenUnsets(doc, published)
  return unset.length ? [{patch: {id: doc._publishedId, type: doc._type, unset}}] : []
}
