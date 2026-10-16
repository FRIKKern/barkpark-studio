import {useMemo, useState, type KeyboardEvent} from 'react'
import {DialogBox} from './FocusScopes'
import {ChevronDown, ChevronLeft, ChevronRight, Close, EarthGlobe, Search} from './icons'
import {toast} from './Toasts'
import {intlTag, useLocale, useT} from '../lib/i18n'
import {dayKey, localZone, storeZone, zoneLabel, zoneLongName, zoneOption, zones} from '../lib/timezone'

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

export function ReleasesCalendar({zone, marked, picked, onPick}: {zone: string; marked: Set<string>; picked: string | null; onPick: (day: string | null) => void}) {
  const t = useT()
  const locale = useLocale()
  const today = dayKey(new Date(), zone)
  const [shown, setShown] = useState(() => ({year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1}))
  const move = (by: number) => setShown(({year, month}) => ({year: year + Math.floor((month + by) / 12), month: (month + by + 12) % 12}))
  const title = new Date(Date.UTC(shown.year, shown.month, 1)).toLocaleDateString(intlTag(locale), {month: 'long', year: 'numeric', timeZone: 'UTC'})
  return (
    <aside className="releases-calendar" aria-label={t('Calendar')}>
      <div className="cal-head">
        <span className="cal-title">{title}</span>
        <button type="button" className="icon-btn" aria-label={t('Previous month')} onClick={() => move(-1)}>
          <ChevronLeft />
        </button>
        <button type="button" className="icon-btn" aria-label={t('Next month')} onClick={() => move(1)}>
          <ChevronRight />
        </button>
      </div>
      <div className="cal-grid" role="grid" aria-label={title}>
        <div role="row" className="cal-weekdays">
          {WEEKDAYS.map((d, i) => (
            <span key={i} role="columnheader" aria-label={new Date(Date.UTC(2026, 9, 4 + i)).toLocaleDateString(intlTag(locale), {weekday: 'long', timeZone: 'UTC'})}>
              {d}
            </span>
          ))}
        </div>
        {Array.from({length: grid(shown.year, shown.month).length / 7}, (_, w) => (
          <div role="row" key={w} className="cal-week">
            {grid(shown.year, shown.month)
              .slice(w * 7, w * 7 + 7)
              .map((d) => {
                const key = keyOf(d)
                const on = picked === key
                return (
                  <span role="gridcell" key={key}>
                    <button
                      type="button"
                      className="cal-day"
                      aria-label={new Date(`${key}T12:00:00Z`).toDateString()}
                      aria-pressed={on}
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
        onClick={() => (setShown({year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1}), onPick(today))}
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
  return (
    <>
      <button type="button" className="releases-zone" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <EarthGlobe /> {zoneLabel(zone)} <ChevronDown />
      </button>
      {open && (
        <ZoneDialog
          zone={zone}
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

function ZoneDialog({zone, onClose, onPick}: {zone: string; onClose: () => void; onPick: (zone: string) => void}) {
  const t = useT()
  const [chosen, setChosen] = useState(zone)
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const all = useMemo(() => zones().map((z) => ({zone: z, ...zoneOption(z)})), [])
  const q = query?.trim().toLowerCase() ?? ''
  const options = query === null ? [] : all.filter((o) => !q || o.city.toLowerCase().includes(q) || o.zone.toLowerCase().includes(q) || o.name.toLowerCase().includes(q)).slice(0, 50)
  const choose = (z: string) => (setChosen(z), setQuery(null))
  const keys = (e: KeyboardEvent) => {
    if (!options.length) return
    if (e.key === 'ArrowDown') e.preventDefault(), setActive((i) => Math.min(i + 1, options.length - 1))
    else if (e.key === 'ArrowUp') e.preventDefault(), setActive((i) => Math.max(i - 1, 0))
    else if (e.key === 'Enter') e.preventDefault(), choose(options[active]!.zone)
    else if (e.key === 'Escape') e.stopPropagation(), setQuery(null)
  }
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog zone-dialog" aria-modal="true" aria-labelledby="zone-title" onClose={onClose}>
        <header>
          <h2 id="zone-title">{t('Select time zone')}</h2>
          <button type="button" className="icon-btn" aria-label={t('Close dialog')} onClick={onClose}>
            <Close />
          </button>
        </header>
        <div className="dialog-body">
          <p>{t('The selected time zone will change how dates are represented in content releases.')}</p>
          <label className="zone-label" htmlFor="zone-search">
            {t('Time zone')} {chosen === localZone() && <span className="muted">{t('local time')}</span>}
          </label>
          <div className="zone-combo">
            <span className="zone-input">
              <Search />
              <input
                id="zone-search"
                role="combobox"
                aria-expanded={options.length > 0}
                aria-controls="zone-options"
                aria-activedescendant={options.length ? `zone-${active}` : undefined}
                autoComplete="off"
                placeholder={t('Search for a city or time zone')}
                value={query ?? zoneLongName(chosen)}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => (setQuery(e.target.value), setActive(0))}
                onKeyDown={keys}
              />
              {(query ?? zoneLongName(chosen)) && (
                <button type="button" className="icon-btn" aria-label={t('Clear')} onClick={() => (setQuery(''), setActive(0))}>
                  <Close />
                </button>
              )}
            </span>
            <button type="button" className="zone-open" aria-label={t('Open')} onClick={() => setQuery((v) => (v === null ? '' : null))}>
              <ChevronDown />
            </button>
            {options.length > 0 && (
              <div id="zone-options" role="listbox" className="zone-options">
                {options.map((o, i) => (
                  <div key={o.zone} id={`zone-${i}`} role="option" aria-selected={i === active} className="zone-option" onMouseDown={(e) => (e.preventDefault(), choose(o.zone))} onMouseEnter={() => setActive(i)}>
                    <span>
                      {o.city} <span className="muted">({o.offset})</span>
                    </span>
                    <span className="zone-name">{o.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <footer>
          <button type="button" className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="button" className="btn btn-primary" disabled={chosen === zone} onClick={() => onPick(chosen)}>
            {t('Update time zone')}
          </button>
        </footer>
      </DialogBox>
    </div>
  )
}
