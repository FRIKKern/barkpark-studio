import {queryOptions} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {bpFetch, serviceToken} from '../server/barkpark'
import {workspaceRoster} from './members'

/**
 * The workspace's people by email, for every people picker (lib/members.ts). Read with
 * the studio's token (listing members needs it); only the emails reach the page.
 */
const fetchPeople = createServerFn({method: 'GET'}).handler(() =>
  workspaceRoster(async (offset) => {
    const res = await bpFetch(`/v1/members?limit=200&offset=${offset}`, {}, await serviceToken())
    if (!res.ok) throw new Error(`Could not load the users (${res.status})`)
    return res.json()
  }),
)
type Roster = {people: string[]; names: Record<string, string>}
const roster = {queryKey: ['people'], staleTime: 5 * 60_000, queryFn: async () => (await fetchPeople()) as Roster}
export const peopleQuery = queryOptions({...roster, select: (r: Roster) => r.people})
/** Each person's name as Barkpark gives it, by email (lib/person.ts names everyone through it). */
export const peopleNamesQuery = queryOptions({...roster, select: (r: Roster) => r.names})
