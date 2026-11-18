// J69 Members for admins: the roster, the access requests and the invitations, read and changed
// with the signed-in editor's OWN token. Never the studio's (serviceToken): Barkpark's admin gate
// and its role ceiling judge the caller's seat, so with the studio's seat anyone who reaches
// the studio could seat anyone, themselves included. Shared sign-in (everyone is the studio's
// token) reads and never writes. Every read is fresh (`fresh`): a list shown after a change
// must not answer from before it (the shared reads in server/barkpark.ts).
import '@tanstack/react-start/server-only'
import {bpFetch, forgetMemberReads, requestToken} from './barkpark'
import {currentEditor, describeToken, signInRequired} from './auth'
import {fakeFetch, fakeMembers} from './members-fake'
import {OWNER, readsRequests, type Access, type AccessRequest, type Change, type Invitation, type MembersData, type Seat} from '../lib/members-admin'

type Answer = {status: number; body: {error?: {code?: string; message?: string}} & Record<string, unknown>}

async function call(path: string, init: RequestInit = {}): Promise<Answer> {
  const fake = fakeMembers()
  const write = (init.method ?? 'GET') !== 'GET'
  // A refused write (429) is said, not retried: the admin sees it and presses again.
  const res = fake ? await fakeFetch(fake, path, init) : await bpFetch(path, init, requestToken(), {fresh: true, retry: !write})
  const body = (await res.json().catch(() => ({}))) as Answer['body']
  return {status: res.status, body}
}

/** Who is asking: their access before Barkpark is asked, their email and role here. */
async function actor(): Promise<{access: Access; email: string | null; role: string | null}> {
  const fake = fakeMembers()
  if (fake) return {access: 'manage', email: fake.email, role: fake.role}
  if (!signInRequired()) return {access: 'read_only', email: null, role: null}
  const editor = currentEditor()
  if (!editor) return {access: 'signed_out', email: null, role: null}
  const self = await describeToken(editor.token)
  if (self.refused) return {access: 'signed_out', email: null, role: null}
  return {access: 'manage', email: editor.email, role: self.role ?? null}
}

const PAGE = 200
const MAX_PAGES = 10

/** The screen's data: every page of the roster (owners counted across people and tokens), the requests and invitations. */
export async function loadMembers(): Promise<MembersData> {
  const who = await actor()
  const me = {email: who.email, role: who.role}
  const empty = {me, people: [], owners: 0, tokens: 0, requests: [], invitations: []}
  if (who.access === 'signed_out') return {access: 'signed_out', ...empty}
  const seats: Seat[] = []
  for (let page = 0, offset = 0; page < MAX_PAGES; page++) {
    const a = await call(`/v1/members?limit=${PAGE}&offset=${offset}`)
    if (a.status === 401) return {access: 'signed_out', ...empty}
    if (a.status === 403) return {access: 'not_admin', ...empty}
    if (a.status >= 300) throw new Error(`Could not load the members (${a.status})`)
    const body = a.body as {members?: Seat[]; hasMore?: boolean; nextOffset?: number}
    seats.push(...(body.members ?? []))
    if (!body.hasMore || body.nextOffset === undefined || body.nextOffset <= offset) break
    offset = body.nextOffset
  }
  // The editor's role as the roster has it: the seat itself, over what their token said a minute ago.
  const mine = who.email ? seats.find((s) => s.principal_type === 'user' && s.identity?.toLowerCase() === who.email!.toLowerCase()) : undefined
  const role = mine?.role ?? who.role
  // Requests and invitations name people who have no seat yet: read only for an owner or admin
  // (never in shared sign-in, whose token is the studio's), so they never reach anyone else's browser.
  const none: Answer = {status: 200, body: {}}
  const [requests, invitations] = readsRequests(who.access, role) ? await Promise.all([call('/v1/access-requests'), call('/v1/invitations')]) : [none, none]
  return {
    access: who.access,
    me: {email: who.email, role},
    people: seats.filter((s) => s.principal_type === 'user'),
    owners: seats.filter((s) => s.role === OWNER).length,
    tokens: seats.filter((s) => s.principal_type !== 'user').length,
    requests: requests.status < 300 ? ((requests.body.access_requests as AccessRequest[] | undefined) ?? []) : [],
    invitations: invitations.status < 300 ? ((invitations.body.invitations as Invitation[] | undefined) ?? []) : [],
  }
}

/** How many access requests wait, for an owner or admin seat only (null for anyone else: nothing is read). */
export async function waitingRequests(): Promise<number | null> {
  const who = await actor()
  if (!readsRequests(who.access, who.role)) return null
  const a = await call('/v1/access-requests')
  return a.status < 300 ? ((a.body.access_requests as unknown[] | undefined)?.length ?? 0) : null
}

/** A change, as the editor: refused here first when they may not ask it (Barkpark refuses it again). */
async function change(path: string, method: string, body?: unknown, ceiling?: (role: string | null) => boolean): Promise<Change> {
  const who = await actor()
  if (who.access === 'signed_out') return {ok: false, status: 401, code: 'session_lost'}
  if (who.access === 'read_only') return {ok: false, status: 403, code: 'shared'}
  if (ceiling && !ceiling(who.role)) return {ok: false, status: 403, code: 'owner_required'}
  const a = await call(path, {method, ...(body !== undefined && {headers: {'content-type': 'application/json'}, body: JSON.stringify(body)})})
  forgetMemberReads()
  if (a.status < 300) return {ok: true, status: a.status, ...(a.body.reclaimed === true && {reclaimed: true})}
  return {ok: false, status: a.status, code: a.body.error?.code, message: a.body.error?.message}
}

const id = (raw: string) => encodeURIComponent(raw)
const ownerOnly = (role: string) => (actorRole: string | null) => role !== OWNER || actorRole === OWNER

// `from`: the seat's role as the screen showed it, for the owner check here; Barkpark checks the
// seat's real role again.
export const approve = (requestId: string, role: string) => change(`/v1/access-requests/${id(requestId)}/approve`, 'POST', {role}, ownerOnly(role))
export const deny = (requestId: string) => change(`/v1/access-requests/${id(requestId)}/deny`, 'POST', {})
export const setRole = (principalId: string, from: string, role: string) => change(`/v1/members/${id(principalId)}`, 'PATCH', {role}, (actorRole) => ownerOnly(role)(actorRole) && ownerOnly(from)(actorRole))
export const removeSeat = (principalId: string, from: string) => change(`/v1/members/${id(principalId)}`, 'DELETE', undefined, ownerOnly(from))
export const invite = (email: string, role: string) => change('/v1/members', 'POST', {email, role}, ownerOnly(role))
export const withdrawInvitation = (invitationId: string) => change(`/v1/invitations/${id(invitationId)}`, 'DELETE')
