// J69 Members for admins: the rules the Members screen keeps before Barkpark judges a
// change (it judges every one again: the role ceiling, last-owner protection, the seat).
// Pure, so the rules have a fast test (members-admin.test.ts). The calls are in
// server/members-admin.ts, the screen in components/Members.tsx.

/** One roster row (Barkpark's GET …/v1/members), a person or an API token. */
export type Seat = {principal_type: string; principal_id: string; role: string; identity?: string | null; display_name?: string | null; revoked?: boolean | null; inserted_at?: string}
/** A pending access request, the admin's view (GET …/v1/access-requests). */
export type AccessRequest = {id: string; user_id?: string; email?: string | null; display_name?: string | null; note?: string | null; inserted_at?: string}
/** A pending invitation (GET …/v1/invitations). */
export type Invitation = {id: string; email?: string | null; role: string; inserted_at?: string; bind_on_sso?: boolean}

/**
 * What this editor may do on the screen. `manage`: their own seat here is owner or admin.
 * `read_only`: shared sign-in (everyone works as the studio's token), so nobody can be told
 * apart: the roster shows, nothing changes (a person with no seat could approve their own
 * request with the studio's seat otherwise). `not_admin`: Barkpark refused the roster (403).
 */
export type Access = 'manage' | 'read_only' | 'not_admin' | 'signed_out'

export type MembersData = {
  access: Access
  /** The editor: their email and their role here (null when unknown). */
  me: {email: string | null; role: string | null}
  /** The people with a seat, in Barkpark's order (owners first). */
  people: Seat[]
  /** Every owner seat, people and tokens: Barkpark's last-owner rule counts both. */
  owners: number
  /** API tokens with a seat: managed in Barkpark, counted here. */
  tokens: number
  requests: AccessRequest[]
  invitations: Invitation[]
}

/** A change's answer: Barkpark's body, or its refusal (status, and its error code and message). */
export type Change = {ok: true; status: number; reclaimed?: boolean} | {ok: false; status: number; code?: string; message?: string}

export const OWNER = 'owner'
const BUILT_IN = ['owner', 'admin', 'member', 'contributor']
export const DEFAULT_ROLE = 'member'

export const isAdminRole = (role: string | null | undefined) => role === 'owner' || role === 'admin'

/** Whether the server reads the access requests and invitations (askers' emails and notes,
 * invitees' emails) at all: only for an owner or admin acting as themselves. Shared sign-in reads
 * with the studio's token, so it never gets them, whatever that token's seat may see. */
export const readsRequests = (access: Access, role: string | null | undefined) => access === 'manage' && isAdminRole(role)

/** The roles the workspace is seen to use: the built-ins, then any custom role on a seat or invitation. */
export const knownRoles = (seen: Iterable<string>) => [...new Set([...BUILT_IN, ...[...seen].filter((r) => !!r)])]

/**
 * The roles this editor may hand out (Barkpark's ruling #5): never one above their own. Only an
 * owner grants owner; an admin grants admin and below.
 */
export const rolesOffered = (actorRole: string | null, known: string[] = BUILT_IN) => (isAdminRole(actorRole) ? known.filter((r) => r !== OWNER || actorRole === OWNER) : [])

export type SeatRule = {roles: string[]; change: boolean; remove: boolean; why?: 'owner_only' | 'last_owner'}

/**
 * What this editor may do to one seat. An owner's seat is changed or removed only by an owner,
 * and the last owner is neither demoted nor removed (the workspace would have nobody who can
 * administer it). `roles`: the picker's choices, the seat's own role among them.
 */
export function seatRule(seat: Seat, actorRole: string | null, owners: number, known: string[] = BUILT_IN): SeatRule {
  if (!isAdminRole(actorRole)) return {roles: [seat.role], change: false, remove: false}
  if (seat.role === OWNER && actorRole !== OWNER) return {roles: [seat.role], change: false, remove: false, why: 'owner_only'}
  if (seat.role === OWNER && owners <= 1) return {roles: [seat.role], change: false, remove: false, why: 'last_owner'}
  const roles = rolesOffered(actorRole, known)
  return {roles: roles.includes(seat.role) ? roles : [seat.role, ...roles], change: true, remove: true}
}

/** May this role go to this seat (a role change), by the rule above? */
export const mayChangeTo = (seat: Seat, role: string, actorRole: string | null, owners: number, known?: string[]) => {
  const rule = seatRule(seat, actorRole, owners, known)
  return rule.change && role !== seat.role && rule.roles.includes(role)
}

/** Approve's body: the picked role when this editor may grant it, else nothing is sent. */
export function approveBody(picked: string | undefined, actorRole: string | null, known?: string[]): {role: string} | null {
  const role = picked || DEFAULT_ROLE
  return rolesOffered(actorRole, known).includes(role) ? {role} : null
}

/** An editor's own request (they hold a seat, so Barkpark refuses it anyway): never approved by them. */
export const ownRequest = (r: AccessRequest, myEmail: string | null) => !!myEmail && !!r.email && r.email.trim().toLowerCase() === myEmail.trim().toLowerCase()
export const isMe = (seat: Seat, myEmail: string | null) => !!myEmail && !!seat.identity && seat.identity.trim().toLowerCase() === myEmail.trim().toLowerCase()

/** One click, one request: a second press of the same action while the first is out is dropped. */
export function singleFlight() {
  const out = new Set<string>()
  return {
    start: (key: string) => (out.has(key) ? false : (out.add(key), true)),
    end: (key: string) => void out.delete(key),
    busy: (key: string) => out.has(key),
  }
}

/** Something to invite: an address with one @ and a dot after it, nothing around it. */
export const inviteEmail = (raw: string) => {
  const email = raw.trim()
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && email.length <= 254 ? email : null
}

type T = (en: string, vars?: Record<string, string | number>) => string

/** Barkpark's answer to a change, in words. `code`/`message`: its error envelope. */
export function refusal(status: number, code: string | undefined, message: string | undefined, t: T): string {
  const msg = (message ?? '').toLowerCase()
  if (status === 401 || code === 'session_lost') return t("You've been logged out. Sign in again to manage members.")
  if (code === 'owner_required') return t('Only an owner can grant, change or remove the Owner role.')
  if (code === 'role_exceeds_token') return t('Your token lacks the admin permission, so it cannot give a role with admin rights.')
  if (code === 'shared') return t('Everyone works as one identity in this studio, so seats are changed in Barkpark.')
  if (status === 403) return t("You can't manage members in this workspace: your role here is not Owner or Administrator.")
  if (code === 'last_owner') return t('This is the last owner. Make someone else an owner first.')
  if (code === 'already_member') return t('That person already has a seat here.')
  if (code === 'already_invited') return t('That person already has an invitation waiting.')
  if (status === 404 && msg.includes('e-mail')) return t('No account has that email address.')
  if (status === 404) return t('That is no longer here: another admin may have handled it. The list is up to date.')
  if (status === 422 && msg.includes('email')) return t('That is not an email address Barkpark accepts.')
  if (status === 422 && msg.includes('role')) return t('That role does not exist in this workspace.')
  if (status === 422) return t('Barkpark could not do that. Check what you entered and try again.')
  if (status === 429) return t('Too many changes at once. Wait a moment and try again.')
  return t('Barkpark did not answer ({status}). Nothing was changed; try again.', {status})
}

/** What an invite did (Barkpark seats a new address at once, invites an existing account). */
export function invited(status: number, body: {reclaimed?: boolean}, email: string, t: T): string {
  if (status === 202) return t('{email} is invited. They get a seat when they accept.', {email})
  if (body.reclaimed) return t('{email} has a seat now. Their unconfirmed account was reset: they sign in with a password reset or a magic link.', {email})
  return t('{email} has a seat now.', {email})
}

/** A role as people read it (Barkpark's built-ins, as the user menu names them). */
export function roleTitle(role: string, t: T): string {
  if (role === 'owner') return t('Owner')
  if (role === 'admin') return t('Administrator')
  if (role === 'member') return t('Member')
  if (role === 'contributor') return t('Contributor')
  return role.charAt(0).toUpperCase() + role.slice(1)
}

/** A seat's or request's person, named: their display name, else their email (a deleted account: none). */
export const personName = (p: {display_name?: string | null; identity?: string | null; email?: string | null}) => p.display_name?.trim() || p.identity || p.email || null
