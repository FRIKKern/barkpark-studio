import {useEffect, useRef, useState, type KeyboardEvent} from 'react'
import {ZoneDialog} from './ZoneDialog'
import {ChevronDown, ChevronLeft, ChevronRight, Close, EarthGlobe} from './icons'
import {toast} from './Toasts'
import {intlTag, useLocale, useT} from '../lib/i18n'
import {dayKey, storeZone, zoneLabel, zoneLongName} from '../lib/timezone'
import {useNow} from '../lib/now'

// The Releases tool's month calendar and time zone, as Sanity's (task-f8d14f136de4ed6d):
// days with a schedule in bold, today tinted, a click filters the list to that day (again:
// back to all); the zone only changes how times are shown.

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/** The 6 × 7 days around a month, from its first Sunday, as Sanity's grid. */
function grid(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1))
  const start = new Date(first)
  start.setUTCDate(1 - first.getUTCDay())
  const days = Array.from({length: 42}, (_, i) => new Date(start.getTime() + i * 86_400_000))
  // Sanity draws only the weeks the month touches.
  const weeks = Math.ceil((first.getUTCDay() + new Date(Date.UTC(year, month + 1, 0)).getUTCDate()) / 7)
  return days.slice(0, weeks * 7)
}
const keyOf = (d: Date) => d.toISOString().slice(0, 10)

// A day's button name, as Date#toDateString ("Mon Sep 28 2026") but of the day itself: read in
// UTC, not this computer's zone (UTC+14 named the 27th "Mon Sep 28", and the server another).
const DAY_NAME = new Intl.DateTimeFormat('en-US', {weekday: 'short', month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC'})
const dayLabel = (key: string) => {
  const p = Object.fromEntries(DAY_NAME.formatToParts(new Date(`${key}T12:00:00Z`)).map((x) => [x.type, x.value]))
  return `${p.weekday} ${p.month} ${p.day} ${p.year}`
}

export function ReleasesCalendar({zone, marked, picked, onPick, disabled}: {zone: string; marked: Set<string>; picked: string | null; onPick: (day: string | null) => void; disabled?: boolean}) {
  const t = useT()
  const locale = useLocale()
  // The month opens on the day the server rendered (lib/now.ts), so hydration draws the same
  // month; today's tint, in this browser's clock and zone, only once in the browser.
  const now = useNow()
  const [today, setToday] = useState<string>()
  useEffect(() => setToday(dayKey(new Date(), zone)), [zone, now])
  const [shown, setShown] = useState(() => {
    const day = dayKey(new Date(now), zone)
    return {year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) - 1}
  })
  // One Tab stop for the month, as a WAI-ARIA grid (and Sanity's date picker): the picked
  // day, else today, else the 1st; arrow keys move it a day or a week, into the next month.
  const cells = grid(shown.year, shown.month)
  const keys = cells.map(keyOf)
  const [focusKey, setFocusKey] = useState<string>()
  const stop = [focusKey, picked ?? undefined, today].find((k) => k && keys.includes(k)) ?? keys[cells.findIndex((d) => d.getUTCMonth() === shown.month)]
  const days = useRef<HTMLDivElement>(null)
  const moved = useRef(false)
  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    days.current?.querySelector<HTMLButtonElement>(`[data-key="${stop}"]`)?.focus()
  })
  const onDayKey = (e: KeyboardEvent) => {
    const step = ({ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7} as Record<string, number>)[e.key]
    const from = (e.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset.key
    if (!step || !from) return
    e.preventDefault()
    const [y, m, d] = from.split('-').map(Number)
    const next = new Date(Date.UTC(y!, m! - 1, d! + step))
    if (!keys.includes(keyOf(next))) setShown({year: next.getUTCFullYear(), month: next.getUTCMonth()})
    setFocusKey(keyOf(next))
    moved.current = true
  }
  const move = (by: number) => setShown(({year, month}) => ({year: year + Math.floor((month + by) / 12), month: (month + by + 12) % 12}))
  const title = new Date(Date.UTC(shown.year, shown.month, 1)).toLocaleDateString(intlTag(locale), {month: 'long', year: 'numeric', timeZone: 'UTC'})
  return (
    <aside className="releases-calendar" aria-label={t('Calendar')}>
      <div className="cal-head">
        <span className="cal-title">{title}</span>
        <button type="button" className="icon-btn" aria-label={t('Go to previous month')} disabled={disabled} onClick={() => move(-1)}>
          <ChevronLeft />
        </button>
        <button type="button" className="icon-btn" aria-label={t('Go to next month')} disabled={disabled} onClick={() => move(1)}>
          <ChevronRight />
        </button>
      </div>
      <div className="cal-grid" role="grid" aria-label={title} ref={days} onKeyDown={onDayKey}>
        <div role="row" className="cal-weekdays">
          {WEEKDAYS.map((d, i) => (
            <span key={i} role="columnheader" aria-label={new Date(Date.UTC(2026, 9, 4 + i)).toLocaleDateString(intlTag(locale), {weekday: 'long', timeZone: 'UTC'})}>
              {d}
            </span>
          ))}
        </div>
        {Array.from({length: cells.length / 7}, (_, w) => (
          <div role="row" key={w} className="cal-week">
            {cells
              .slice(w * 7, w * 7 + 7)
              .map((d) => {
                const key = keyOf(d)
                const on = picked === key
                return (
                  <span role="gridcell" key={key}>
                    <button
                      type="button"
                      className="cal-day"
                      aria-label={dayLabel(key)}
                      aria-pressed={on}
                      disabled={disabled}
                      data-key={key}
                      tabIndex={key === stop ? 0 : -1}
                      onFocus={() => setFocusKey(key)}
                      data-other={d.getUTCMonth() !== shown.month || undefined}
                      data-today={key === today || undefined}
                      data-marked={marked.has(key) || undefined}
                      onClick={() => onPick(on ? null : key)}
                    >
                      {on ? <Close /> : d.getUTCDate()}
                    </button>
                  </span>
                )
              })}
          </div>
        ))}
      </div>
      <button
        type="button"
        className="cal-today"
        aria-label={t('Go to today')}
        disabled={disabled}
        onClick={() => {
          const day = today ?? dayKey(new Date(), zone)
          setShown({year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) - 1})
          onPick(day)
        }}
      >
        {t('Today')}
      </button>
    </aside>
  )
}

/** The bar's zone button and Sanity's "Select time zone" dialog. */
export function ZonePicker({zone, onChange}: {zone: string; onChange: (zone: string) => void}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  // Named in the browser's language (task-556f6d421d271155), so only once in the browser: the
  // server's language and zone would draw a different label than the page hydrates to.
  const [named, setNamed] = useState(false)
  useEffect(() => setNamed(true), [])
  return (
    <>
      <button type="button" className="releases-zone" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <EarthGlobe /> <span className="releases-zone-name">{named && zoneLabel(zone)}</span> <ChevronDown />
      </button>
      {open && (
        <ZoneDialog
          zone={zone}
          info={t('The selected time zone will change how dates are represented in content releases.')}
          onClose={() => setOpen(false)}
          onPick={(next) => {
            storeZone(next)
            onChange(next)
            setOpen(false)
            toast({title: t('Time zone updated'), description: zoneLongName(next)})
          }}
        />
      )}
    </>
  )
}
