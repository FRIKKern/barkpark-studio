import {useId, useState, type FormEvent} from 'react'
import {ago, dateTitle, useLocale, useT} from '../lib/i18n'
import {useNow, useZone} from '../lib/now'
import {approveBody, DEFAULT_ROLE, inviteEmail, invited, ownRequest, personName, roleTitle, type AccessRequest, type Invitation} from '../lib/members-admin'
import {approveRequest, denyRequest, inviteMember, withdrawInvite} from '../lib/members-api'
import {ActorAvatar} from './Presence'
import {ChevronDown} from './icons'
import type {Act} from './Members'

// J69 Members: the access requests to approve (with a role) or deny, the invite form and the
// invitations still waiting. Every button is one request: a second press while the first is
// out does nothing (Members' `act`), and the list is read again after each.

export function RoleSelect({value, roles, onChange, label, disabled}: {value: string; roles: string[]; onChange: (role: string) => void; label: string; disabled?: boolean}) {
  const t = useT()
  return (
    <span className="select-box members-role">
      <select className="input" aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {roles.map((r) => (
          <option key={r} value={r}>
            {roleTitle(r, t)}
          </option>
        ))}
      </select>
      <ChevronDown />
    </span>
  )
}

function When({iso, say}: {iso?: string; say: (ago: string) => string}) {
  const locale = useLocale()
  const now = useNow()
  const zone = useZone()
  if (!iso) return null
  return (
    <time className="members-when muted" dateTime={iso} title={dateTitle(iso, locale, zone)}>
      {say(ago(iso, locale, now, zone))}
    </time>
  )
}

export function AccessRequests({requests, roles, myEmail, myRole, act, busy, errors}: {requests: AccessRequest[]; roles: string[]; myEmail: string | null; myRole: string | null; act: Act; busy: Set<string>; errors: Record<string, string>}) {
  const t = useT()
  const head = useId()
  // The role picked per request; Member until changed (Barkpark's default).
  const [picked, setPicked] = useState<Record<string, string>>({})
  return (
    <section className="members-section" aria-labelledby={head} data-testid="members-requests">
      <h2 id={head}>
        {t('Access requests')} {requests.length > 0 && <span className="members-count">{requests.length}</span>}
      </h2>
      {!requests.length ? (
        <p className="members-empty muted">{t('No one is asking for access.')}</p>
      ) : (
        <ul className="members-rows">
          {requests.map((r) => {
            const who = personName(r) ?? t('Unknown account')
            const role = picked[r.id] ?? DEFAULT_ROLE
            const own = ownRequest(r, myEmail)
            const out = busy.has(`approve:${r.id}`) || busy.has(`deny:${r.id}`)
            const body = approveBody(role, myRole, roles)
            return (
              <li key={r.id} className="members-row" data-testid="members-request" aria-busy={out || undefined}>
                <span className="members-avatar">
                  <ActorAvatar actor={r.email ?? r.id} />
                </span>
                <span className="members-who">
                  <span className="members-name">{who}</span>
                  {r.email && r.email !== who && <span className="members-email muted">{r.email}</span>}
                  {r.note && <q className="members-note">{r.note}</q>}
                  <When iso={r.inserted_at} say={(when) => t('Asked {ago}', {ago: when})} />
                </span>
                <span className="members-actions">
                  <RoleSelect value={role} roles={roles} disabled={out || own} label={t('Role for {name}', {name: who})} onChange={(v) => setPicked((p) => ({...p, [r.id]: v}))} />
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={out || own || !body}
                    title={own ? t('This is your own request.') : undefined}
                    onClick={() => body && act(`approve:${r.id}`, r.id, () => approveRequest({data: {id: r.id, role: body.role}}), () => t('{name} can now open the studio as {role}.', {name: who, role: roleTitle(body.role, t)}))}
                  >
                    {busy.has(`approve:${r.id}`) ? t('Approving…') : t('Approve')}
                  </button>
                  <button type="button" className="btn" disabled={out} onClick={() => act(`deny:${r.id}`, r.id, () => denyRequest({data: {id: r.id}}), () => t('Request from {name} denied.', {name: who}))}>
                    {busy.has(`deny:${r.id}`) ? t('Denying…') : t('Deny')}
                  </button>
                </span>
                {errors[r.id] && (
                  <p className="field-error members-error" role="alert">
                    {errors[r.id]}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export function Invite({invitations, roles, act, busy, errors}: {invitations: Invitation[]; roles: string[]; act: Act; busy: Set<string>; errors: Record<string, string>}) {
  const t = useT()
  const head = useId()
  const emailId = useId()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState(DEFAULT_ROLE)
  const [bad, setBad] = useState(false)
  const sending = busy.has('invite:new')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const to = inviteEmail(email)
    setBad(!to)
    if (!to) return
    const ok = await act('invite:new', 'invite', () => inviteMember({data: {email: to, role}}), (c) => invited(c.status, c, to, t))
    if (ok) setEmail('')
  }
  return (
    <section className="members-section" aria-labelledby={head}>
      <h2 id={head}>{t('Invite people')}</h2>
      <form className="members-invite" onSubmit={(e) => void submit(e)} noValidate>
        <label className="members-label" htmlFor={emailId}>
          {t('Email address')}
        </label>
        <span className="members-invite-row">
          <input id={emailId} className="input" type="email" autoComplete="off" value={email} aria-invalid={bad || undefined} aria-describedby={bad ? `${emailId}-bad` : undefined} disabled={sending} onChange={(e) => (setEmail(e.target.value), setBad(false))} />
          <RoleSelect value={role} roles={roles} disabled={sending} label={t('Role for the invited person')} onChange={setRole} />
          <button type="submit" className="btn btn-primary" disabled={sending || !email.trim()}>
            {sending ? t('Inviting…') : t('Invite')}
          </button>
        </span>
        {bad && (
          <p id={`${emailId}-bad`} className="field-error" role="alert">
            {t('Write the whole address, like name@example.com.')}
          </p>
        )}
        {errors.invite && (
          <p className="field-error" role="alert">
            {errors.invite}
          </p>
        )}
      </form>
      {invitations.length > 0 && (
        <>
          <h3 className="members-subhead">{t('Waiting for an answer')}</h3>
          <ul className="members-rows">
            {invitations.map((i) => (
              <li key={i.id} className="members-row" data-testid="members-invitation" aria-busy={busy.has(`withdraw:${i.id}`) || undefined}>
                <span className="members-avatar">
                  <ActorAvatar actor={i.email ?? i.id} />
                </span>
                <span className="members-who">
                  <span className="members-name">{i.email ?? t('Unknown account')}</span>
                  <When iso={i.inserted_at} say={(when) => t('Invited {ago}', {ago: when})} />
                </span>
                <span className="members-actions">
                  <span className="members-badge">{roleTitle(i.role, t)}</span>
                  <button type="button" className="btn" disabled={busy.has(`withdraw:${i.id}`)} onClick={() => act(`withdraw:${i.id}`, i.id, () => withdrawInvite({data: {id: i.id}}), () => t('Invitation to {email} withdrawn.', {email: i.email ?? ''}))}>
                    {busy.has(`withdraw:${i.id}`) ? t('Withdrawing…') : t('Withdraw')}
                  </button>
                </span>
                {errors[i.id] && (
                  <p className="field-error members-error" role="alert">
                    {errors[i.id]}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
