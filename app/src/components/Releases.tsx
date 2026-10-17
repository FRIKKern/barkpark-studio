import {useEffect, useState} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {docQuery, type Doc} from '../lib/data'
import {panesPath} from '../lib/panes'
import {pauseSchedule, schedulesQuery, type Schedule} from '../lib/schedules'
import {deleteSchedule, publishScheduledNow} from '../lib/schedule-actions'
import {intlTag, useLocale, useT} from '../lib/i18n'
import {DocPreview} from './Preview'
import {ReleasesCalendar, ZonePicker} from './ReleasesCalendar'
import {dayKey, localZone, storedZone, zoneShort} from '../lib/timezone'
import {ConfirmDialog} from './DocumentPane'
import {MenuPopover} from './FocusScopes'
import {toast} from './Toasts'
import {ArrowLeft, Calendar, Close, Ellipsis, LockIcon, PublishIcon, ReleaseIllustration, Trash, EditIcon} from './icons'

// Sanity's Releases tool, its Scheduled drafts view (task-ad9c942d7d48c887): every draft
// scheduled to publish (J40), Active, Paused or Archived, from Barkpark's schedules. Content
// releases themselves are plan-gated on the reference and Barkpark has none (task-501a3f96aaec72ec).

type Tab = 'active' | 'paused' | 'archived'
const IN: Record<Tab, (status: string) => boolean> = {
  active: (s) => s === 'scheduled',
  paused: (s) => s === 'paused',
  archived: (s) => s !== 'scheduled' && s !== 'paused',
}
// Sanity's words for an empty tab (its releases tool strings).
const NONE: Record<Tab, string> = {active: 'No Scheduled Drafts', paused: 'No paused scheduled drafts', archived: 'No archived releases'}
const TABS: [Tab, string][] = [
  ['active', 'Active'],
  ['paused', 'Paused'],
  ['archived', 'Archived'],
]

export function Releases() {
  const t = useT()
  const {data, error, isPending} = useQuery(schedulesQuery)
  const [tab, setTab] = useState<Tab>('active')
  // Sanity's "Scheduled for" sorts soonest first; a click turns it.
  const [soonest, setSoonest] = useState(true)
  // The zone times are shown in (stored in UTC, as Barkpark keeps them); this browser's
  // own until it has read the one picked here (task-f8d14f136de4ed6d).
  const [zone, setZone] = useState(localZone)
  useEffect(() => setZone(storedZone()), [])
  // A day picked in the calendar: what is set to publish that day (Active and Paused).
  const [day, setDay] = useState<string | null>(null)
  const all = data?.schedules ?? []
  const marked = new Set(all.filter((s) => s.status === 'scheduled' || s.status === 'paused').map((s) => dayKey(new Date(s.publishAt), zone)))
  const rows = all.filter((s) => (day ? !IN.archived(s.status) && dayKey(new Date(s.publishAt), zone) === day : IN[tab](s.status))).sort((a, b) => (soonest ? 1 : -1) * a.publishAt.localeCompare(b.publishAt))
  const locale = useLocale()
  return (
    <div className="releases">
    {/* Nothing scheduled at all: Sanity's calendar has nothing to pick, so it is greyed out. */}
    <ReleasesCalendar zone={zone} marked={marked} picked={day} onPick={setDay} disabled={!!data && !all.length} />
    <main className="releases-main" aria-label={t('Releases')}>
      <header className="releases-bar">
        <span className="releases-view">
          <Calendar /> {t('Scheduled drafts')}
        </span>
        {day ? (
          <span className="releases-day">
            {dayTitle(day, intlTag(locale))}
            <button type="button" className="icon-btn" aria-label={t('Clear')} onClick={() => setDay(null)}>
              <Close />
            </button>
          </span>
        ) : all.length > 0 && (
          <div className="releases-tabs" role="group" aria-label={t('Scheduled drafts')}>
            {TABS.map(([key, label]) => (
              <button key={key} type="button" className="releases-tab" aria-pressed={tab === key} onClick={() => setTab(key)}>
                {t(label)}
              </button>
            ))}
          </div>
        )}
        <ZonePicker zone={zone} onChange={setZone} />
      </header>
      {error ? (
        <p className="releases-empty" role="alert">
          {(error as Error).message}
        </p>
      ) : isPending ? null : !data.supported ? (
        <Empty text={t('This Barkpark does not schedule publishes yet.')} />
      ) : !all.length ? (
        <Empty text={t('Schedule and lock draft documents for publishing at a future date and time.')} />
      ) : (
        <table className="releases-table">
          <thead>
            <tr>
              <th scope="col">{t('Document')}</th>
              <th scope="col" aria-sort={soonest ? 'ascending' : 'descending'}>
                <button type="button" className="releases-sort" onClick={() => setSoonest((s) => !s)}>
                  {t('Scheduled for')} <span className={soonest ? 'up' : 'down'}><ArrowLeft /></span>
                </button>
              </th>
              <th scope="col">
                <span className="sr-only">{t('Actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <Row key={s._id} schedule={s} tab={IN.active(s.status) ? 'active' : IN.paused(s.status) ? 'paused' : 'archived'} zone={zone} />
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={3} className="releases-none">
                  {t(day ? NONE.active : NONE[tab])}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </main>
    </div>
  )
}

/** Sanity's chip for a picked day: "October 19th, 2026" (its own date format elsewhere). */
function dayTitle(day: string, tag: string) {
  const at = new Date(`${day}T12:00:00Z`)
  if (!tag.startsWith('en')) return at.toLocaleDateString(tag, {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'})
  const n = at.getUTCDate()
  const th = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'
  return `${at.toLocaleDateString('en-US', {month: 'long', timeZone: 'UTC'})} ${n}${th}, ${at.getUTCFullYear()}`
}

function Empty({text}: {text: string}) {
  const t = useT()
  return (
    <div className="releases-empty">
      <ReleaseIllustration />
      <strong>{t('Scheduled Drafts')}</strong>
      <p>{text}</p>
    </div>
  )
}

const STATUS: Record<string, string> = {scheduled: 'Scheduled', paused: 'Paused', completed: 'Published', published: 'Published', cancelled: 'Deleted', failed: 'Failed'}

function Row({schedule, tab, zone}: {schedule: Schedule; tab: Tab; zone: string}) {
  const t = useT()
  const locale = useLocale()
  const qc = useQueryClient()
  const {data: doc} = useQuery(docQuery(schedule.type, schedule.documentId))
  const [menu, setMenu] = useState(false)
  const [asking, setAsking] = useState<'publish' | 'delete' | null>(null)
  // In the picked zone; named when it is not this computer's, as Sanity's "(EDT)".
  const at = new Date(schedule.publishAt)
  const when = at.toLocaleString(intlTag(locale), {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: zone}) + (zone === localZone() ? '' : ` (${zoneShort(zone, at)})`)
  const href = panesPath([{kind: 'types'}, {kind: 'list', type: schedule.type}, {kind: 'doc', id: schedule.documentId, type: schedule.type}])
  const pause = () =>
    pauseSchedule({data: {scheduleId: schedule._id}})
      .then(() => Promise.all([qc.invalidateQueries({queryKey: ['schedules']}), qc.invalidateQueries({queryKey: ['schedule', schedule.documentId]})]))
      .catch((e: Error) => toast({tone: 'critical', title: t('Could not pause the schedule'), description: e.message}))
  return (
    <tr>
      <td>{doc === null ? <span className="releases-gone">{schedule.documentId}</span> : <DocPreview doc={doc} href={href} selected={false} iconless={false} />}</td>
      <td>
        <span className="releases-when">
          <span className="releases-state">
            {tab === 'active' && <LockIcon />} {t(STATUS[schedule.status] ?? schedule.status)} ·
          </span>
          <span>{when}</span>
        </span>
      </td>
      <td className="releases-actions">
        {tab !== 'archived' && doc && (
          <div className="menu-wrap">
            <button type="button" className="icon-btn" aria-label={t('Scheduled draft actions')} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              <Ellipsis />
            </button>
            {menu && (
              <MenuPopover className="popover menu releases-menu" onClose={() => setMenu(false)}>
                <button type="button" role="menuitem" className="menu-item" onClick={() => (setMenu(false), setAsking('publish'))}>
                  <span className="menu-icon-text">
                    <PublishIcon /> {t('Publish now')}
                  </span>
                </button>
                {tab === 'active' && (
                  <button type="button" role="menuitem" className="menu-item" onClick={() => (setMenu(false), void pause())}>
                    <span className="menu-icon-text">
                      <EditIcon /> {t('Pause to edit')}
                    </span>
                  </button>
                )}
                <button type="button" role="menuitem" className="menu-item danger" onClick={() => (setMenu(false), setAsking('delete'))}>
                  <span className="menu-icon-text">
                    <Trash /> {t('Delete schedule')}
                  </span>
                </button>
              </MenuPopover>
            )}
          </div>
        )}
        {asking === 'publish' && doc && (
          <ConfirmDialog
            title={t('Publish draft now')}
            body={t('Are you sure you want to publish this scheduled draft immediately?')}
            action={t('Yes, run now')}
            run={() => publishScheduledNow(qc, doc as Doc, schedule)}
            onClose={() => setAsking(null)}
          />
        )}
        {asking === 'delete' && doc && (
          <ConfirmDialog
            title={t('Delete scheduled draft')}
            body={t('Delete this scheduled draft? Your draft is already up to date.')}
            action={t('Yes, delete schedule')}
            run={() => deleteSchedule(qc, doc as Doc, schedule)}
            onClose={() => setAsking(null)}
          />
        )}
      </td>
    </tr>
  )
}
