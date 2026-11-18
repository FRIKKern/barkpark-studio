// e2e only (STUDIO_E2E_HOOKS=1, POST /api/e2e-listen {action: 'members-fake', role, ms}): the
// Members screen's calls (server/members-admin.ts) answered by a small Barkpark of its own, so a
// spec or a scene can approve, deny, invite, re-role and remove without seating anyone real
// (seats are real on the hosted Barkpark). It keeps Barkpark's rules: only an owner grants,
// changes or removes owner (403 owner_required), the last owner stays (409 last_owner), a seat
// is not added twice (409 already_member), an unknown id is 404; a non-admin is refused (403).
// `ms`: each write waits that long first (a slow answer). `writes`: how many writes came in.
import type {AccessRequest, Invitation, Seat} from '../lib/members-admin'

type Fake = {email: string; role: string; ms: number; writes: number; seats: Seat[]; requests: AccessRequest[]; invitations: Invitation[]; next: number}
let fake: Fake | null = null

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString()
const user = (id: string, identity: string, role: string, display_name: string | null = null): Seat => ({principal_type: 'user', principal_id: id, role, identity, display_name, revoked: null, inserted_at: at(60 * 24 * 30)})

/** Turn the fake on with this editor's role (the actor is you@example.com), or off (null). */
export function setMembersFake(role: string | null, ms = 0) {
  if (!role) return void (fake = null)
  const you = user('u-you', 'you@example.com', role, 'You Example')
  // You are the only owner when you are one: the last-owner rule has something to hold.
  const owner = role === 'owner' ? [] : [user('u-olga', 'olga@example.com', 'owner', 'Olga Owner')]
  fake = {
    email: you.identity!,
    role,
    ms,
    writes: 0,
    next: 1,
    seats: [...(role === 'owner' ? [you] : [...owner, you]), user('u-ada', 'ada@example.com', 'admin', 'Ada Lovelace'), user('u-ben', 'ben@example.com', 'member'), user('u-cora', 'cora@example.com', 'contributor', 'Cora Contrib'), {principal_type: 'api_token', principal_id: 't-1', role: 'member', identity: 'ci', revoked: false}, {principal_type: 'api_token', principal_id: 't-2', role: 'admin', identity: 'deploy', revoked: false}],
    requests: [
      {id: 'r-dag', user_id: 'u-dag', email: 'dag@example.com', display_name: 'Dag Solstad', note: 'Copy editor for the spring issue', inserted_at: at(90)},
      {id: 'r-eli', user_id: 'u-eli', email: 'eli@example.com', display_name: null, note: null, inserted_at: at(60 * 26)},
    ],
    invitations: [{id: 'i-finn', email: 'finn@example.com', role: 'member', inserted_at: at(60 * 5), bind_on_sso: false}],
  }
}

export const fakeMembers = () => (process.env.STUDIO_E2E_HOOKS === '1' ? fake : null)
export const fakeWrites = () => fake?.writes ?? 0

const json = (status: number, body: unknown) => Response.json(body, {status})
const refuse = (status: number, code: string, message = code) => json(status, {error: {code, message}})
const owners = (f: Fake) => f.seats.filter((s) => s.role === 'owner').length

/** Barkpark's answer to a Members call, from the fake. */
export async function fakeFetch(f: Fake, path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase()
  const body = init.body ? (JSON.parse(String(init.body)) as {role?: string; email?: string}) : {}
  if (f.role !== 'owner' && f.role !== 'admin') return refuse(403, 'forbidden', 'token lacks required permission')
  const u = new URL(path, 'http://fake')
  if (method === 'GET') {
    if (u.pathname === '/v1/members') {
      const offset = Number(u.searchParams.get('offset') ?? 0)
      const limit = Number(u.searchParams.get('limit') ?? 100)
      const members = f.seats.slice(offset, offset + limit)
      const hasMore = offset + members.length < f.seats.length
      return json(200, {members, count: members.length, total: f.seats.length, limit, offset, hasMore, ...(hasMore && {nextOffset: offset + members.length})})
    }
    if (u.pathname === '/v1/access-requests') return json(200, {access_requests: f.requests})
    if (u.pathname === '/v1/invitations') return json(200, {invitations: f.invitations})
    return refuse(404, 'not_found')
  }
  f.writes++
  if (f.ms) await new Promise((r) => setTimeout(r, f.ms))
  const ceiling = (from: string | null, to: string | null) => (from === 'owner' || to === 'owner') && f.role !== 'owner'
  let m: RegExpMatchArray | null
  if ((m = u.pathname.match(/^\/v1\/access-requests\/([^/]+)\/(approve|deny)$/))) {
    const r = f.requests.find((x) => x.id === decodeURIComponent(m![1]!))
    if (!r) return refuse(404, 'not_found', 'no pending access request with that id here')
    if (m[2] === 'approve') {
      const role = body.role ?? 'member'
      if (ceiling(null, role)) return refuse(403, 'owner_required')
      f.seats.push(user(r.user_id!, r.email!, role, r.display_name ?? null))
    }
    f.requests = f.requests.filter((x) => x !== r)
    return json(200, {access_request: {...r, status: m[2] === 'approve' ? 'approved' : 'denied'}})
  }
  if (u.pathname === '/v1/members' && method === 'POST') {
    const email = (body.email ?? '').trim().toLowerCase()
    const role = body.role ?? 'member'
    if (!email.includes('@')) return refuse(422, 'unprocessable', 'email must be a valid address')
    if (ceiling(null, role)) return refuse(403, 'owner_required')
    if (f.seats.some((s) => s.identity === email)) return refuse(409, 'already_member')
    if (f.invitations.some((i) => i.email === email)) return refuse(409, 'already_invited')
    // An address with an account (one at example.org) is invited; a new one is seated at once.
    if (email.endsWith('@example.org')) {
      const invitation = {id: `i-${f.next++}`, email, role, inserted_at: new Date().toISOString(), bind_on_sso: false}
      f.invitations.push(invitation)
      return json(202, {invitation})
    }
    const seat = user(`u-${f.next++}`, email, role)
    f.seats.push(seat)
    return json(201, {member: seat})
  }
  if ((m = u.pathname.match(/^\/v1\/invitations\/([^/]+)$/)) && method === 'DELETE') {
    const i = f.invitations.find((x) => x.id === decodeURIComponent(m![1]!))
    if (!i) return refuse(404, 'not_found', 'no such invitation in this workspace')
    f.invitations = f.invitations.filter((x) => x !== i)
    return json(200, {withdrawn: i})
  }
  if ((m = u.pathname.match(/^\/v1\/members\/([^/]+)$/))) {
    const s = f.seats.find((x) => x.principal_type === 'user' && x.principal_id === decodeURIComponent(m![1]!))
    if (!s) return refuse(404, 'not_found', 'no such member in this workspace')
    if (method === 'PATCH') {
      const role = body.role ?? ''
      if (ceiling(s.role, role)) return refuse(403, 'owner_required')
      if (s.role === 'owner' && role !== 'owner' && owners(f) <= 1) return refuse(409, 'last_owner')
      s.role = role
      if (s.principal_id === 'u-you') f.role = role
      return json(200, {member: s})
    }
    if (method === 'DELETE') {
      if (ceiling(s.role, null)) return refuse(403, 'owner_required')
      if (s.role === 'owner' && owners(f) <= 1) return refuse(409, 'last_owner')
      f.seats = f.seats.filter((x) => x !== s)
      if (s.principal_id === 'u-you') f.role = 'none'
      return json(200, {removed: s})
    }
  }
  return refuse(404, 'not_found')
}
