import {useEffect, useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import type {Resolved} from '../../lib/dashboard'
import {upcomingQuery} from '../../lib/dashboard-data'
import {localZone, storedZone, zoneShort} from '../../lib/timezone'
import {intlTag, useLocale, useT} from '../../lib/i18n'
import {Calendar} from '../icons'
import {PaneLink} from '../PaneLink'
import {DocRows, editHref} from './DocRows'
import {RowList, WidgetEmpty, WidgetError, WidgetFrame, WidgetSkeleton} from './Widget'

/**
 * Scheduled (J40, the Releases tool's data): the next scheduled publishes, the soonest
 * first, each row its document and when it publishes; the row opens the document. Two
 * reads: Barkpark's pending schedules, then their documents in one (lib/dashboard-data.ts).
 * Schedules are not documents, so no live frame names them: the widget reads again when one
 * of its documents is published (the schedule ran; components/Dashboard.tsx), on Refresh and
 * when the tab gets the focus back.
 */
export function ScheduledWidget({widget}: {widget: Extract<Resolved, {kind: 'scheduled'}>}) {
  const t = useT()
  const locale = useLocale()
  const q = useQuery(upcomingQuery(widget.limit))
  // Times in the zone picked in Releases (this computer's until one is), named when it is another.
  const [zone, setZone] = useState(localZone)
  useEffect(() => setZone(storedZone()), [])
  const title = t(widget.title)
  const whenOf = new Map((q.data?.rows ?? []).map(({schedule}) => [schedule.documentId.replace(/^drafts\./, ''), schedule.publishAt]))
  const when = (iso: string) => {
    const at = new Date(iso)
    return at.toLocaleString(intlTag(locale), {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: zone}) + (zone === localZone() ? '' : ` (${zoneShort(zone, at)})`)
  }
  const docs = (q.data?.rows ?? []).flatMap((r) => (r.doc ? [r.doc] : []))
  const gone = (q.data?.rows ?? []).filter((r) => !r.doc)
  return (
    <WidgetFrame
      title={title}
      width={widget.width}
      rows={Math.min(widget.limit, 5)}
      testId={`dash-${widget.key}`}
      onRefresh={() => void q.refetch()}
      refreshing={q.isFetching && !q.isPending}
      footer={
        q.data?.supported !== false && (
          <PaneLink className="btn dash-more" href="/releases">
            <Calendar /> {q.data && q.data.total > q.data.rows.length ? t('All {count} scheduled drafts', {count: q.data.total}) : t('View Scheduled Drafts')}
          </PaneLink>
        )
      }
    >
      {q.isError ? (
        <WidgetError error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : !q.data ? (
        <WidgetSkeleton rows={3} />
      ) : !q.data.supported ? (
        <WidgetEmpty title={t('Scheduling is not available')} hint={t('This Barkpark does not schedule publishes.')} />
      ) : !q.data.rows.length ? (
        <WidgetEmpty title={t('No Scheduled Drafts')} hint={t('A draft scheduled to publish shows up here.')} />
      ) : (
        <>
          <DocRows
            docs={docs}
            label={title}
            aside={(d) => (
              <time className="dash-when" dateTime={whenOf.get(d._publishedId)}>
                {when(whenOf.get(d._publishedId)!)}
              </time>
            )}
          />
          {/* A schedule whose document is gone still runs (and fails): it is named, not hidden. */}
          {gone.length > 0 && (
            <RowList label={t('Scheduled, document not found')} className="dash-rows dash-gone">
              {gone.map(({schedule}) => (
                <li key={schedule._id} data-dash-row="">
                  <PaneLink className="dash-gone-row" href={editHref({_publishedId: schedule.documentId.replace(/^drafts\./, ''), _type: schedule.type})}>
                    <span className="muted">{schedule.documentId}</span>
                    <time className="dash-when" dateTime={schedule.publishAt}>
                      {when(schedule.publishAt)}
                    </time>
                  </PaneLink>
                </li>
              ))}
            </RowList>
          )}
        </>
      )}
    </WidgetFrame>
  )
}
