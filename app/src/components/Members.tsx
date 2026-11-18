import {useId, useRef, useState} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {Link} from '@tanstack/react-router'
import {useT} from '../lib/i18n'
import {barkparkInfoQuery} from '../lib/diagnostics'
import {currentScopeQuery} from '../lib/scope-switch'
import {isAdminRole, isMe, knownRoles, personName, refusal, roleTitle, rolesOffered, seatRule, singleFlight, type Change, type MembersData, type Seat} from '../lib/members-admin'
import {changeRole, membersAdminQuery, removeMember, waitingRequestsQuery} from '../lib/members-api'
import {ActorAvatar} from './Presence'
import {ConfirmDialog} from './ConfirmDialog'
import {AccessRequests, Invite, RoleSelect} from './MembersRequests'
import {toast} from './Toasts'
import {LaunchIcon, RefreshIcon, Search, Trash} from './icons'

// J69 Members for admins (Sanity sends admins to sanity.io/manage): an owner or admin seat sees
// the workspace's people with their roles, the access requests waiting, and the invitations;
// approves (with a role) or denies, invites by email, changes a role, removes a seat. The rules
// (no role above your own, the last owner stays) are lib/members-admin.ts; Barkpark judges each
// change again with the editor's own token (server/members-admin.ts). Anyone else is told why.

/** One action, one request: `key` names it (a second press while it is out is dropped), `row` where its error shows. */
export type Act = (key: string, row: string, run: () => Promise<Change>, done?: (c: Extract<Change, {ok: true}>) => string) => Promise<boolean>

const FILTER_FROM = 8

export function Members() {
  const t = useT()
  const qc = useQueryClient()
  const q = useQuery(membersAdminQuery)
  const scope = useQuery(currentScopeQuery).data
  const adminUrl = useQuery(barkparkInfoQuery).data?.adminUrl
  const once = useRef(singleFlight()).current
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const head = useId()
  // The list after a change, and everything else that shows seats: the people pickers, the waiting count.
  const refresh = () => Promise.all([qc.invalidateQueries({queryKey: membersAdminQuery.queryKey}), qc.invalidateQueries({queryKey: ['people']}), qc.invalidateQueries({queryKey: waitingRequestsQuery.queryKey})])
  const act: Act = async (key, row, run, done) => {
    if (!once.start(key)) return false
    setBusy((b) => new Set(b).add(key))
    setErrors(({[row]: _, ...rest}) => rest)
    try {
      const c = await run()
      if (c.ok) done && toast({tone: 'positive', title: done(c)})
      else setErrors((e) => ({...e, [row]: refusal(c.status, c.code, c.message, t)}))
      return c.ok
    } catch {
      setErrors((e) => ({...e, [row]: t('The answer did not arrive. The list now shows what Barkpark has.')}))
      return false
    } finally {
      once.end(key)
      setBusy((b) => (b.delete(key), new Set(b)))
      await refresh()
    }
  }
  const open = adminUrl ? (
    <a className="btn btn-ghost members-open" href={adminUrl} target="_blank" rel="noreferrer">
      <LaunchIcon /> {t('Open in Barkpark')}
    </a>
  ) : null
  return (
    <main className="members-page" aria-labelledby={head}>
      <div className="members-inner">
        <header className="members-head">
          <div>
            <h1 id={head}>{t('Members')}</h1>
            {scope && <p className="muted">{t('Who can open {workspace}, and who is asking to.', {workspace: scope.workspace})}</p>}
          </div>
          <span className="members-head-actions">
            <button type="button" className="icon-btn dash-refresh" aria-label={t('Refresh members')} data-tip={t('Refresh')} data-busy={q.isFetching ? '' : undefined} onClick={() => void refresh()}>
              <RefreshIcon />
            </button>
            {open}
          </span>
        </header>
        {q.isPending ? (
          <p className="members-empty muted" role="status">
            {t('Loading members…')}
          </p>
        ) : q.isError ? (
          <div className="members-banner" role="alert">
            <p>{t('Could not load the members.')}</p>
            <button type="button" className="btn" onClick={() => void q.refetch()}>
              {t('Retry')}
            </button>
          </div>
        ) : (
          <Body data={q.data} act={act} busy={busy} errors={errors} />
        )}
      </div>
    </main>
  )
}

function Body({data, act, busy, errors}: {data: MembersData; act: Act; busy: Set<string>; errors: Record<string, string>}) {
  const t = useT()
  if (data.access === 'signed_out')
    return (
      <div className="members-banner" role="alert">
        <p>{t("You've been logged out. Sign in again to manage members.")}</p>
        <Link className="btn btn-primary" to="/login" search={{redirect: '/members'}}>
          {t('Sign in')}
        </Link>
      </div>
    )
  if (data.access === 'not_admin')
    return (
      <div className="members-banner" role="alert" data-testid="members-refused">
        <p>{t("You can't manage members in this workspace: your role here is not Owner or Administrator.")}</p>
        {data.me.role && <p className="muted">{t('Your role: {role}.', {role: roleTitle(data.me.role, t)})}</p>}
      </div>
    )
  const manage = data.access === 'manage' && isAdminRole(data.me.role)
  const known = knownRoles([...data.people.map((p) => p.role), ...data.invitations.map((i) => i.role)])
  const roles = rolesOffered(data.me.role, known)
  return (
    <>
      {!manage && (
        <p className="members-banner" role="note">
          {data.access === 'read_only' ? t('Everyone works as one identity in this studio, so seats are changed in Barkpark.') : t("You can't manage members in this workspace: your role here is not Owner or Administrator.")}
        </p>
      )}
      {manage && <AccessRequests requests={data.requests} roles={roles} myEmail={data.me.email} myRole={data.me.role} act={act} busy={busy} errors={errors} />}
      {manage && <Invite invitations={data.invitations} roles={roles} act={act} busy={busy} errors={errors} />}
      <Roster data={data} manage={manage} known={known} act={act} busy={busy} errors={errors} />
    </>
  )
}

type Pending = {seat: Seat; to: string | null}

function Roster({data, manage, known, busy, errors}: {data: MembersData; manage: boolean; known: string[]; act: Act; busy: Set<string>; errors: Record<string, string>}) {
  const t = useT()
  const qc = useQueryClient()
  const head = useId()
  const [filter, setFilter] = useState('')
  // A role change (`to`) or a removal (`to` null) waiting for its confirmation.
  const [pending, setPending] = useState<Pending | null>(null)
  const needle = filter.trim().toLowerCase()
  const shown = needle ? data.people.filter((p) => `${p.display_name ?? ''} ${p.identity ?? ''}`.toLowerCase().includes(needle)) : data.people
  const nameOf = (s: Seat) => personName(s) ?? t('Deleted account')
  const confirm = async () => {
    const {seat, to} = pending!
    try {
      const c = to ? await changeRole({data: {id: seat.principal_id, from: seat.role, role: to}}) : await removeMember({data: {id: seat.principal_id, from: seat.role}})
      if (!c.ok) throw new Error(refusal(c.status, c.code, c.message, t))
      toast({tone: 'positive', title: to ? t("{name}'s role is now {role}.", {name: nameOf(seat), role: roleTitle(to, t)}) : t('{name} no longer has a seat here.', {name: nameOf(seat)})})
    } finally {
      await Promise.all([qc.invalidateQueries({queryKey: membersAdminQuery.queryKey}), qc.invalidateQueries({queryKey: ['people']})])
    }
  }
  const self = pending && isMe(pending.seat, data.me.email)
  const loses = self && (!pending!.to || !isAdminRole(pending!.to))
  return (
    <section className="members-section" aria-labelledby={head} data-testid="members-roster">
      <h2 id={head}>
        {t('People')} <span className="members-count">{data.people.length}</span>
      </h2>
      {data.people.length > FILTER_FROM && (
        <label className="members-filter">
          <Search />
          <input className="input" type="search" value={filter} aria-label={t('Filter members')} placeholder={t('Filter by name or email')} onChange={(e) => setFilter(e.target.value)} />
        </label>
      )}
      {!shown.length ? (
        <p className="members-empty muted">{needle ? t('No one matches “{filter}”.', {filter: filter.trim()}) : t('No people have a seat here yet.')}</p>
      ) : (
        <ul className="members-rows">
          {shown.map((s) => {
            const rule = seatRule(s, manage ? data.me.role : null, data.owners, known)
            const why = rule.why === 'last_owner' ? t('The last owner cannot be demoted or removed. Make someone else an owner first.') : rule.why === 'owner_only' ? t('Only an owner can change or remove an owner.') : undefined
            const name = nameOf(s)
            return (
              <li key={s.principal_id} className="members-row" data-testid="members-person">
                <span className="members-avatar">
                  <ActorAvatar actor={s.identity ?? s.principal_id} />
                </span>
                <span className="members-who">
                  <span className="members-name">
                    {name}
                    {isMe(s, data.me.email) && <span className="muted"> ({t('you')})</span>}
                  </span>
                  {s.identity && s.identity !== name && <span className="members-email muted">{s.identity}</span>}
                  {manage && why && <span className="members-why muted">{why}</span>}
                </span>
                <span className="members-actions">
                  {manage && rule.change ? (
                    <RoleSelect value={s.role} roles={rule.roles} label={t('Role of {name}', {name})} onChange={(to) => to !== s.role && setPending({seat: s, to})} />
                  ) : (
                    <span className="members-badge" data-role={s.role}>
                      {roleTitle(s.role, t)}
                    </span>
                  )}
                  {manage && (
                    <button type="button" className="icon-btn members-remove" aria-label={t('Remove {name}', {name})} data-tip={why ?? t('Remove {name}', {name})} disabled={!rule.remove || busy.size > 0} onClick={() => setPending({seat: s, to: null})}>
                      <Trash />
                    </button>
                  )}
                </span>
                {errors[s.principal_id] && (
                  <p className="field-error members-error" role="alert">
                    {errors[s.principal_id]}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {data.tokens > 0 && <p className="members-foot muted">{t('{count} API tokens also hold seats here. They are managed in Barkpark.', {count: data.tokens})}</p>}
      {pending && (
        <ConfirmDialog
          title={pending.to ? t('Change role?') : t('Remove {name}?', {name: nameOf(pending.seat)})}
          body={[
            pending.to ? t("{name}'s role changes from {from} to {to}.", {name: nameOf(pending.seat), from: roleTitle(pending.seat.role, t), to: roleTitle(pending.to, t)}) : t('{name} loses access to this workspace at once.', {name: nameOf(pending.seat)}),
            loses ? t('This is you: you will no longer be able to manage members.') : '',
          ]
            .filter(Boolean)
            .join(' ')}
          action={pending.to ? t('Change role') : t('Remove')}
          tone={pending.to ? 'primary' : 'danger'}
          run={confirm}
          onClose={() => setPending(null)}
        />
      )}
    </section>
  )
}
