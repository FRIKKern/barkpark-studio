// task-cc6a6d85be054b17, Sanity's request-access screen: what a signed-in person with no
// seat in this workspace sees, from Barkpark's answers (barkpark #26848). The asker's side
// only: POST, GET and DELETE /v1/auth/access-requests, and their own invitations at
// /v1/auth/invitations. Pure: the server calls are server/access-requests.ts, the screen
// components/RequestAccess.tsx. Words are English keys for t(), with their values.

/** A request as its asker sees it (Barkpark's own_row). */
export type OwnRequest = {id: string; workspace: string; status: 'pending' | 'approved' | 'denied' | (string & {}); note: string | null; inserted_at: string; decided_at: string | null}
/** One of the account's pending invitations (Barkpark's list_invitations_for_user). */
export type Invitation = {id: string; workspace: string; workspace_name?: string | null; role: string; inserted_at?: string}
/** Barkpark's answer to one call: its status (0 when it never answered), error code and Retry-After. */
export type Answer = {status: number; code?: string; message?: string; retryAfter?: number}

/** What the server read for this workspace. `unavailable`: this sign-in can't ask (dev or shared). */
export type AccessView = {kind: 'unavailable'} | {kind: 'signed_out'} | {kind: 'error'; answer: Answer} | {kind: 'ok'; requests: OwnRequest[]; invitations: Invitation[]}

export type Words = {en: string; vars?: Record<string, string | number>}

export type Screen =
  | {view: 'loading'}
  | {view: 'unavailable'}
  | {view: 'failed'}
  | {view: 'invited'; invitation: Invitation}
  | {view: 'form'; again?: 'denied' | 'removed'}
  | {view: 'pending'; id: string; sentAt: string; note: string | null}
  | {view: 'denied'; decidedAt: string | null}
  | {view: 'approved'; id: string}

/** Barkpark's AccessRequest.note_max: the longest note it keeps, in characters. */
export const NOTE_MAX = 500
/** While a request waits: how often the screen asks whether it was decided. */
export const POLL_MS = 15_000

/**
 * The screen for what Barkpark answered. The server already kept only this workspace's
 * rows; the newest request decides. A pending invitation comes first: accepting it is the
 * way in, no request needed. `entered`: approved requests the page already let in once
 * (refreshed who is signed in); still here after that, the seat has since gone, so ask
 * again. `askAgain`: the person chose to ask again after a decline.
 */
export function screenFor(view: AccessView | undefined, {entered, askAgain}: {entered?: ReadonlySet<string>; askAgain?: boolean} = {}): Screen {
  if (!view) return {view: 'loading'}
  if (view.kind === 'unavailable') return {view: 'unavailable'}
  if (view.kind === 'signed_out') return {view: 'loading'}
  if (view.kind === 'error') return {view: 'failed'}
  const invitation = view.invitations[0]
  if (invitation) return {view: 'invited', invitation}
  const last = newest(view.requests)
  if (!last) return {view: 'form'}
  if (last.status === 'pending') return {view: 'pending', id: last.id, sentAt: last.inserted_at, note: last.note}
  if (last.status === 'denied') return askAgain ? {view: 'form', again: 'denied'} : {view: 'denied', decidedAt: last.decided_at}
  if (last.status === 'approved') return entered?.has(last.id) ? {view: 'form', again: 'removed'} : {view: 'approved', id: last.id}
  return {view: 'form'}
}

/** Newest first, as Barkpark lists them; sorted again so the order never rests on that. */
const newest = (rows: OwnRequest[]) => [...rows].sort((a, b) => Date.parse(b.inserted_at) - Date.parse(a.inserted_at))[0]

/** Poll while a request waits, so an approval lets the person in without a reload. */
export const pollEvery = (screen: Screen): number | false => (screen.view === 'pending' ? POLL_MS : false)

export type Action = 'ask' | 'withdraw' | 'accept' | 'decline' | 'load'
/** What follows a refusal: ask who is signed in again (they may be in, or out), read the rows again, or stay. */
export type Then = 'refresh_me' | 'refetch' | 'stay'

/**
 * A refusal in plain words, and what the page does next. The asker learns nothing about
 * the workspace from these: Barkpark answers a missing workspace as an existing one.
 */
export function refusal(action: Action, a: Answer): {then: Then; words: Words} {
  if (a.status === 401) return {then: 'refresh_me', words: {en: 'Your session has ended. Sign in again.'}}
  if (a.status === 409 && a.code === 'already_member') return {then: 'refresh_me', words: {en: 'You already have access to this workspace. Opening it…'}}
  if (a.status === 403 && a.code === 'email_unconfirmed') return {then: 'stay', words: {en: 'Confirm your email address before asking for access.'}}
  if (a.status === 409 && a.code === 'too_many_pending') return {then: 'stay', words: {en: 'You have {count} pending access requests. Withdraw one before asking for another.', vars: {count: Number(a.message?.match(/\d+/)?.[0] ?? 20)}}}
  if (a.status === 429) return {then: 'stay', words: {en: "You've reached the limit for access requests. Try again in {minutes} min.", vars: {minutes: Math.max(1, Math.ceil((a.retryAfter && a.retryAfter > 0 ? a.retryAfter : 720) / 60))}}}
  if (action === 'ask' && a.status === 422) return {then: 'stay', words: /\bnote\b/.test(a.message ?? '') ? {en: 'The message can be at most {max} characters.', vars: {max: NOTE_MAX}} : {en: "Access can't be requested at this address."}}
  if (action === 'withdraw' && a.status === 404) return {then: 'refetch', words: {en: 'This request was already decided or withdrawn.'}}
  if ((action === 'accept' || action === 'decline') && a.status === 404) return {then: 'refetch', words: {en: 'This invitation is no longer open.'}}
  if (action === 'accept' && a.status === 422) return {then: 'stay', words: {en: 'The invitation could not be accepted. Ask an admin to invite you again.'}}
  const failed: Record<Action, string> = {
    ask: 'There was a problem submitting your request. Please try again.',
    withdraw: 'The request could not be withdrawn. Try again.',
    accept: 'The invitation could not be answered. Try again.',
    decline: 'The invitation could not be answered. Try again.',
    load: 'Your access requests could not be checked. Try again.',
  }
  return {then: 'stay', words: {en: failed[action]}}
}

/** The role an invitation offers, as the user menu names Barkpark's roles. */
export const roleWords = (role: string): string => ({owner: 'Owner', admin: 'Admin', member: 'Member', contributor: 'Contributor', viewer: 'Viewer'})[role] ?? role

/** The note as it is sent: trimmed, and none when empty. */
export const noteToSend = (note: string): string | undefined => note.trim() || undefined
