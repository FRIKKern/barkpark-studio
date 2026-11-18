import {queryOptions} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {approve, deny, invite, loadMembers, removeSeat, setRole, waitingRequests, withdrawInvitation} from '../server/members-admin'
import type {Change, MembersData} from './members-admin'

// J69 Members for admins: the server functions behind components/Members.tsx. The rules are in
// lib/members-admin.ts, the Barkpark calls (as the editor's own token) in server/members-admin.ts.

const fetchMembers = createServerFn({method: 'GET'}).handler(() => loadMembers())
const fetchWaiting = createServerFn({method: 'GET'}).handler(() => waitingRequests())

/** The screen's data. Read again each time the tab comes back (another admin may have acted meanwhile). */
export const membersAdminQuery = queryOptions({queryKey: ['members-admin'], queryFn: async () => (await fetchMembers()) as unknown as MembersData, staleTime: 0, refetchOnWindowFocus: true})
/** How many access requests wait (null: not an owner or admin seat), for the workspace menu. */
export const waitingRequestsQuery = queryOptions({queryKey: ['members-waiting'], queryFn: async () => (await fetchWaiting()) as number | null, staleTime: 60_000, refetchOnWindowFocus: true})

// Each input is a short string: anything else is refused before Barkpark is asked.
const str = (v: unknown, max = 200): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error('invalid input')
  return v.trim()
}
const ref = (v: unknown) => {
  const s = str(v, 100)
  if (!/^[\w.@+-]+$/.test(s)) throw new Error('invalid input')
  return s
}

export const approveRequest = createServerFn({method: 'POST'})
  .validator((d: {id: string; role: string}) => ({id: ref(d.id), role: ref(d.role)}))
  .handler(({data}): Promise<Change> => approve(data.id, data.role))
export const denyRequest = createServerFn({method: 'POST'})
  .validator((d: {id: string}) => ({id: ref(d.id)}))
  .handler(({data}): Promise<Change> => deny(data.id))
export const changeRole = createServerFn({method: 'POST'})
  .validator((d: {id: string; from: string; role: string}) => ({id: ref(d.id), from: ref(d.from), role: ref(d.role)}))
  .handler(({data}): Promise<Change> => setRole(data.id, data.from, data.role))
export const removeMember = createServerFn({method: 'POST'})
  .validator((d: {id: string; from: string}) => ({id: ref(d.id), from: ref(d.from)}))
  .handler(({data}): Promise<Change> => removeSeat(data.id, data.from))
export const inviteMember = createServerFn({method: 'POST'})
  .validator((d: {email: string; role: string}) => ({email: str(d.email, 254), role: ref(d.role)}))
  .handler(({data}): Promise<Change> => invite(data.email, data.role))
export const withdrawInvite = createServerFn({method: 'POST'})
  .validator((d: {id: string}) => ({id: ref(d.id)}))
  .handler(({data}): Promise<Change> => withdrawInvitation(data.id))
