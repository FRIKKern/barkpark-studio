// e2e only (STUDIO_E2E_HOOKS=1, POST /api/e2e-listen {action: 'access', op, …}): a stand-in
// for Barkpark's asker routes (server/access-requests.ts) and a seatless signed-in person in
// whoAmI, so the request-access screen runs in a browser with no real seat, request or
// invitation ever written (seats are real: never on the hosted Barkpark). Off by default.
//   on      a person (`email`) with no seat here, no requests, `invitations` if given;
//   off     back to Barkpark;
//   decide  an admin approves (`status: 'approved'`, the seat appears) or denies the newest pending one;
//   fail    the next `count` calls with `method` answer `status`, `code`, `message`, `retryAfter`;
//   hang    every call waits `ms` first.
// GET /api/e2e-listen?access=1 reads the calls made, so a spec can count what was sent.
import type {Invitation, OwnRequest} from '../lib/access-request'
import type {Called} from './access-requests'

type Fail = {method: string; status: number; code?: string; message?: string; retryAfter?: number; left: number}
type Stub = {email: string; seated: boolean; requests: OwnRequest[]; invitations: Invitation[]; fails: Fail[]; hangMs: number; calls: {method: string; path: string; body?: unknown}[]}
let stub: Stub | null = null

export const accessStub = () => (process.env.STUDIO_E2E_HOOKS === '1' ? stub : null)

/** whoAmI's stand-in person while the stub is on: their email, and whether they sit here now. */
export const stubPerson = () => {
  const s = accessStub()
  return s ? {email: s.email, seated: s.seated} : undefined
}

export type StubCommand = {op: 'on' | 'off' | 'decide' | 'fail' | 'hang'; email?: string; invitations?: Invitation[]; status?: number | 'approved' | 'denied'; method?: string; code?: string; message?: string; retryAfter?: number; count?: number; ms?: number}

export function setAccessStub(c: StubCommand) {
  if (c.op === 'off') return void (stub = null)
  if (c.op === 'on') return void (stub = {email: c.email ?? 'no-seat@example.com', seated: false, requests: [], invitations: c.invitations ?? [], fails: [], hangMs: 0, calls: []})
  if (!stub) return
  if (c.op === 'hang') stub.hangMs = c.ms ?? 0
  if (c.op === 'fail') stub.fails.push({method: c.method ?? 'POST', status: Number(c.status), code: c.code, message: c.message, retryAfter: c.retryAfter, left: c.count ?? 1})
  if (c.op === 'decide') {
    const row = stub.requests.find((r) => r.status === 'pending')
    if (!row) return
    Object.assign(row, {status: c.status === 'approved' ? 'approved' : 'denied', decided_at: new Date().toISOString()})
    if (row.status === 'approved') stub.seated = true
  }
}

export const stubCalls = () => accessStub()?.calls ?? []

const json = (status: number, body: unknown, retryAfter?: number): Called => ({status, body, ...(retryAfter && {retryAfter})})
const refused = (status: number, code: string, message = code) => json(status, {error: {code, message}})

export async function stubAnswer(method: string, path: string, body?: unknown): Promise<Called> {
  const s = stub!
  s.calls.push({method, path, ...(body !== undefined && {body})})
  if (s.hangMs) await new Promise((r) => setTimeout(r, s.hangMs))
  const fail = s.fails.find((f) => f.method === method && f.left > 0)
  if (fail) {
    fail.left--
    return fail.status === 0 ? {status: 0} : json(fail.status, {error: {code: fail.code ?? 'error', message: fail.message ?? 'refused'}}, fail.retryAfter)
  }
  if (method === 'GET' && path === '/access-requests') return json(200, {access_requests: [...s.requests].reverse()})
  if (method === 'GET' && path === '/invitations') return json(200, {invitations: s.invitations})
  if (method === 'POST' && path === '/access-requests') {
    const {workspace, note} = body as {workspace: string; note?: string}
    if (s.seated) return refused(409, 'already_member', 'you already have a seat in this workspace')
    if (note && note.length > 500) return refused(422, 'unprocessable', 'note must be text of at most 500 characters')
    const held = s.requests.find((r) => r.workspace === workspace && r.status === 'pending')
    if (held) return json(202, {access_request: held})
    const row: OwnRequest = {id: crypto.randomUUID(), workspace, status: 'pending', note: note ?? null, inserted_at: new Date().toISOString(), decided_at: null}
    s.requests.push(row)
    return json(202, {access_request: row})
  }
  const [, kind, id, verb] = path.split('/')
  if (method === 'DELETE' && kind === 'access-requests') {
    const at = s.requests.findIndex((r) => r.id === id && r.status === 'pending')
    if (at < 0) return refused(404, 'not_found', 'no such pending access request for this account')
    return json(200, {withdrawn: s.requests.splice(at, 1)[0]})
  }
  if (kind === 'invitations') {
    const at = s.invitations.findIndex((i) => i.id === id)
    if (at < 0) return refused(404, 'not_found', 'no such invitation for this account')
    const [inv] = s.invitations.splice(at, 1)
    if (method === 'POST' && verb === 'accept') return (s.seated = true), json(201, {member: {role: inv!.role}})
    return json(200, {declined: id})
  }
  return refused(404, 'not_found')
}
