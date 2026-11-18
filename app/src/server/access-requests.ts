// task-cc6a6d85be054b17: the asker's side of Barkpark's access requests (#26848) and the
// account's own invitations, called as the signed-in person: their login session is the
// bearer (an account or SSO sign-in; Barkpark refuses a token nobody owns, so dev and
// shared sign-in can't ask). Never the studio's token. The workspace is the page's
// (scope(), from the URL), never one the browser names.
import '@tanstack/react-start/server-only'
import {currentEditor, forgetToken, loginSessionMode} from './auth'
import {scope} from './barkpark'
import {accessStub, stubAnswer} from './access-stub'
import type {AccessView, Answer, Invitation, OwnRequest} from '../lib/access-request'

export type Called = {status: number; body?: unknown; retryAfter?: number}

/** One call to Barkpark's /v1/auth as `token`; status 0 when it never answered. */
async function call(token: string, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<Called> {
  if (accessStub()) return stubAnswer(method, path, body)
  try {
    const res = await fetch(`${process.env.BARKPARK_URL}/v1/auth${path}`, {
      method,
      headers: {authorization: `Bearer ${token}`, ...(body !== undefined && {'content-type': 'application/json'})},
      ...(body !== undefined && {body: JSON.stringify(body)}),
      signal: AbortSignal.timeout(10_000),
    })
    const retry = Number(res.headers.get('retry-after'))
    return {status: res.status, body: await res.json().catch(() => undefined), ...(retry > 0 && {retryAfter: retry})}
  } catch {
    return {status: 0}
  }
}

/** Barkpark's error envelope as an Answer. */
export function answerOf(c: Called): Answer {
  const error = (c.body as {error?: {code?: unknown; message?: unknown}} | undefined)?.error
  return {status: c.status, ...(typeof error?.code === 'string' && {code: error.code}), ...(typeof error?.message === 'string' && {message: error.message}), ...(c.retryAfter && {retryAfter: c.retryAfter})}
}

const ok = (c: Called) => c.status >= 200 && c.status < 300

/** The asker: who may ask, as whom, for which workspace. Undefined: this sign-in can't ask. */
function asker(): {token: string; workspace: string} | 'signed_out' | undefined {
  if (accessStub()) return {token: '', workspace: scope().workspace.toLowerCase()}
  if (!loginSessionMode()) return undefined
  const editor = currentEditor()
  return editor ? {token: editor.token, workspace: scope().workspace.toLowerCase()} : 'signed_out'
}

/**
 * Their requests and invitations for this workspace only. An approved request (the seat is
 * there now) or a 401 forgets what the studio knew of the session, so the next "who am I"
 * asks Barkpark again instead of answering from its minute's cache.
 */
export async function accessView(): Promise<AccessView> {
  const who = asker()
  if (!who) return {kind: 'unavailable'}
  if (who === 'signed_out') return {kind: 'signed_out'}
  const [requests, invitations] = await Promise.all([call(who.token, 'GET', '/access-requests'), call(who.token, 'GET', '/invitations')])
  if (!ok(requests)) {
    if (requests.status === 401) forgetToken(who.token)
    return {kind: 'error', answer: answerOf(requests)}
  }
  const rows = ((requests.body as {access_requests?: OwnRequest[]})?.access_requests ?? []).filter((r) => r?.workspace?.toLowerCase() === who.workspace)
  // The invitations are a second way in: unread, the request form still works.
  const invited = ok(invitations) ? ((invitations.body as {invitations?: Invitation[]})?.invitations ?? []).filter((i) => i?.workspace?.toLowerCase() === who.workspace) : []
  if (rows.some((r) => r.status === 'approved')) forgetToken(who.token)
  return {kind: 'ok', requests: rows, invitations: invited}
}

export type Done = {ok: true} | {ok: false; answer: Answer}

async function act(run: (who: {token: string; workspace: string}) => Promise<Called>, seated = false): Promise<Done> {
  const who = asker()
  if (!who) return {ok: false, answer: {status: 403, code: 'unavailable'}}
  if (who === 'signed_out') return {ok: false, answer: {status: 401}}
  const c = await run(who)
  const answer = answerOf(c)
  // In now (an accepted invitation, or Barkpark says they already sit here), or signed out.
  if ((ok(c) && seated) || c.status === 401 || answer.code === 'already_member') forgetToken(who.token)
  return ok(c) ? {ok: true} : {ok: false, answer}
}

/** Ask for a seat in this workspace, with an optional note (Barkpark keeps 500 characters). */
export const askForAccess = (note: string | undefined) => act((who) => call(who.token, 'POST', '/access-requests', {workspace: who.workspace, ...(note && {note})}))

const uuid = /^[0-9a-f-]{36}$/i
const badId: Done = {ok: false, answer: {status: 404, code: 'not_found'}}

/** Withdraw one of their own pending requests (Barkpark matches it to the session's user). */
export const withdrawRequest = (id: string) => (uuid.test(id) ? act((who) => call(who.token, 'DELETE', `/access-requests/${id}`)) : Promise.resolve(badId))

/** Accept or decline one of their own invitations (someone else's answers 404 at Barkpark). */
export const answerInvitation = (id: string, accept: boolean) =>
  uuid.test(id) ? act((who) => call(who.token, accept ? 'POST' : 'DELETE', accept ? `/invitations/${id}/accept` : `/invitations/${id}`), accept) : Promise.resolve(badId)
