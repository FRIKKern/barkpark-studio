import {useQuery, useQueryClient} from '@tanstack/react-query'
import {Link} from '@tanstack/react-router'
import {memberRows, membersRefused, type Resolved} from '../../lib/dashboard'
import {peopleNamesQuery, peopleQuery} from '../../lib/people'
import {usePresences} from '../../lib/presence'
import {currentScopeQuery} from '../../lib/scope-switch'
import {meQuery} from '../../lib/session'
import {studioName} from '../../lib/studio-name'
import {useT} from '../../lib/i18n'
import {ActorAvatar} from '../Presence'
import {WidgetEmpty, WidgetError, WidgetFrame, WidgetSkeleton} from './Widget'
import {waitingRequestsQuery} from '../../lib/members-api'

/**
 * Members (Sanity's Project users): the workspace's people, with a dot on who is in the
 * studio right now (the presence room, already on the tab's stream: no read) and on you. The
 * roster is the people pickers' read (lib/people.ts, kept 5 minutes). A studio whose token
 * may not list members (a read-only token) shows the pickers' empty state, not an error.
 */
export function MembersWidget({widget}: {widget: Extract<Resolved, {kind: 'members'}>}) {
  const t = useT()
  const qc = useQueryClient()
  const people = useQuery(peopleQuery)
  const {data: names = {}} = useQuery(peopleNamesQuery)
  const {data: me} = useQuery(meQuery)
  const here = usePresences()
  const signedIn = !!me?.email && me.signIn !== 'shared'
  const {rows, total, onlineCount} = memberRows(people.data ?? [], names, here.map((p) => p.name), signedIn ? me!.email : null, widget.limit)
  const title = t(widget.title)
  const refused = people.isError && membersRefused(people.error)
  // J69: an owner or admin seat gets the Members screen from here, with how many requests wait.
  const waiting = useQuery(waitingRequestsQuery).data ?? null
  const count = people.data && total > 0 ? <span className="dash-count muted">{signedIn ? t('{online} of {total} online', {online: onlineCount, total}) : t('{total} members', {total})}</span> : null
  const manage =
    waiting === null ? null : (
      <Link className="btn btn-ghost" to="/members">
        {waiting ? t('Manage members ({count} waiting)', {count: waiting}) : t('Manage members')}
      </Link>
    )
  // Both views of the roster are one query: its key reads it again.
  const refresh = () => void qc.refetchQueries({queryKey: peopleQuery.queryKey})
  return (
    <WidgetFrame
      title={title}
      width={widget.width}
      rows={Math.min(widget.limit, 5)}
      testId={`dash-${widget.key}`}
      // Shared sign-in: presence names are not people's emails, so nobody can be matched.
      note={signedIn || !people.data?.length ? undefined : t('Everyone works as one identity in this studio, so it cannot tell who is online.')}
      onRefresh={refresh}
      refreshing={people.isFetching && !people.isPending}
      footer={
        count || manage ? (
          <>
            {count}
            {manage}
          </>
        ) : undefined
      }
    >
      {people.isError && !refused ? (
        <WidgetError error={people.error} onRetry={refresh} retrying={people.isFetching} />
      ) : refused ? (
        <WidgetEmpty title={t('No users found')} hint={t("This studio's token may not list the workspace's members.")} />
      ) : !people.data ? (
        <WidgetSkeleton rows={3} />
      ) : !rows.length ? (
        <WidgetEmpty title={t('No users found')} hint={t('Invite people to the project to see their online status.')} />
      ) : (
        <ul className="dash-rows dash-members" aria-label={title}>
          {rows.map((m) => (
            <li key={m.email} className="dash-member" data-online={m.online ? '' : undefined} data-testid="dash-member">
              <span className="dash-avatar">
                <ActorAvatar actor={m.email} />
                {m.online && <span className="dash-online" role="img" aria-label={t('Online')} title={t('Online')} />}
              </span>
              <span className="dash-member-text">
                <span className="dash-member-name">
                  {m.name}
                  {m.you && <span className="muted"> ({t('you')})</span>}
                </span>
                <span className="dash-member-email muted">{m.email}</span>
              </span>
            </li>
          ))}
          {total > rows.length && <li className="dash-member-more muted">{t('and {count} more', {count: total - rows.length})}</li>}
        </ul>
      )}
    </WidgetFrame>
  )
}

/** Project info (Sanity's): where this studio works. Read with the page (the scope the navbar shows): no read of its own. */
export function ProjectInfoWidget({widget}: {widget: Extract<Resolved, {kind: 'projectInfo'}>}) {
  const t = useT()
  const {data: scope} = useQuery(currentScopeQuery)
  return (
    <WidgetFrame title={t(widget.title)} width={widget.width} testId={`dash-${widget.key}`}>
      <dl className="dash-info">
        <dt>{t('Studio')}</dt>
        <dd>{studioName}</dd>
        <dt>{t('Workspace')}</dt>
        <dd>{scope?.workspace ?? '…'}</dd>
        <dt>{t('Project')}</dt>
        <dd>{scope?.project ?? '…'}</dd>
        <dt>{t('Dataset')}</dt>
        <dd>{scope?.dataset ?? '…'}</dd>
      </dl>
    </WidgetFrame>
  )
}
