import {queryOptions} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset} from '../server/barkpark'

// J62: the site pages a document is on. Barkpark answers for the pages of the
// documents that reference it (each referrer's desk.preview URL, task-c5d5e045e7efcc96);
// the studio config adds the document's own pages (`presentation.locations`), as
// Sanity's resolve.locations does.

export type Location = {title: string; href: string}

const fetchLocations = createServerFn({method: 'GET'})
  .validator((id: string) => id)
  .handler(async ({data: id}) => {
    const res = await bpFetch(`/v1/data/locations/${dataset()}/${encodeURIComponent(id)}`)
    if (!res.ok) return [] // an older Barkpark, or a document this token can't see
    const body = (await res.json()) as {result?: {locations?: {title?: string; url?: string}[]}}
    return (body.result?.locations ?? []).flatMap((l) => (l.url ? [{title: l.title || l.url, href: l.url}] : []))
  })

export const locationsQuery = (id: string) =>
  queryOptions({queryKey: ['locations', id], queryFn: () => fetchLocations({data: id}) as Promise<Location[]>, staleTime: 10_000})
