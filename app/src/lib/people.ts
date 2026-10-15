import {queryOptions} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {bpFetch, serviceToken} from '../server/barkpark'
import {workspacePeople} from './members'

/**
 * The workspace's people by email, for every people picker (lib/members.ts). Read with
 * the studio's token (listing members needs it); only the emails reach the page.
 */
const fetchPeople = createServerFn({method: 'GET'}).handler(() =>
  workspacePeople(async (offset) => {
    const res = await bpFetch(`/v1/members?limit=200&offset=${offset}`, {}, await serviceToken())
    if (!res.ok) throw new Error(`Could not load the users (${res.status})`)
    return res.json()
  }),
)
export const peopleQuery = queryOptions({queryKey: ['people'], staleTime: 5 * 60_000, queryFn: async () => (await fetchPeople()) as string[]})
