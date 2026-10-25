import {useContext, useEffect, useRef, useState, type KeyboardEvent} from 'react'
import {useFocusScope} from '../lib/focus-scope'
import {Calendar, ChevronLeft, ChevronRight, ChevronDown, EarthGlobe} from './icons'
import {intlTag, translate, useLocale, useT, type Locale} from '../lib/i18n'
import {formatDate, onTimeStep, parseDate} from '../lib/date-format'
import {unsavedElsewhere} from '../lib/edits'
import {localZone, zoneLongName, zoneShort} from '../lib/timezone'
import {reportParseError} from '../lib/parse-errors'
import {DocIdContext} from './doc-ids'

// Sanity's date-time input (J31): a text field in local time ("2026-09-06 11:00")
// that commits on blur or Enter when it parses (half-typed dates never land), plus a calendar popover — month select, year
// stepper, a day grid driven by the keyboard, a time box and "Set to current time".
// The store keeps ISO UTC, like Sanity's datetime. Sanity's options shape the box: dateFormat
// and timeFormat (moment tokens, defaults YYYY-MM-DD and HH:mm) and timeStep (minutes, for the
// time box). `dateOnly` is Sanity's date: no time, stored as YYYY-MM-DD.

const pad = (n: number) => String(n).padStart(2, '0')
const STORED_DATE = 'YYYY-MM-DD'
export type DateOptions = {dateFormat?: string; timeFormat?: string; timeStep?: number}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// The names as Sanity's calendar words them (its nb-NO pack: Januar, Mars; Man, Tir, Søn), by a
// context key, so "May" and "Sun" stay the calendar's own.
const monthNames = (locale: Locale) => MONTHS.map((m) => translate(locale, `calendar month\u0004${m}`))
// The week's first day: Sunday in English (Sanity's calendar), Monday in Norwegian.
const weekStart = (locale: Locale) => (locale === 'nb-NO' ? 1 : 0)
const dayNames = (locale: Locale) => {
  const names = DAYS.map((d) => translate(locale, `calendar day\u0004${d}`))
  return [...names.slice(weekStart(locale)), ...names.slice(0, weekStart(locale))]
}
const dayLabel = (d: Date, locale: Locale) =>
  locale === 'en' ? d.toDateString() : d.toLocaleDateString(intlTag(locale), {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'})
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes())

/**
 * `min`, `notice`: Sanity's schedule dialog (task-7821e8da66b7d5a9): the days before `min`
 * can't be picked, and `notice` heads the open calendar ("Select a date in the future.").
 */
export function DateTimeInput({id, value, onChange, readOnly, dateOnly = false, options = {}, placeholder, calendarLabel, min, notice, autoFocus, showZone}: {id: string; value: string | undefined; onChange: (v: unknown) => void; readOnly?: boolean; dateOnly?: boolean; options?: DateOptions; placeholder?: string; calendarLabel?: string; min?: Date; notice?: string; autoFocus?: boolean; showZone?: boolean}) {
  const t = useT()
  const format = dateOnly ? (options.dateFormat ?? STORED_DATE) : `${options.dateFormat ?? STORED_DATE} ${options.timeFormat ?? 'HH:mm'}`
  const formatLocal = (d: Date) => formatDate(d, format)
  const parseLocal = (text: string) => parseDate(text, format)
  // A date is stored as the day itself (no time zone); a datetime as an instant.
  const stored = value ? (dateOnly ? parseDate(value, STORED_DATE) : new Date(value)) : undefined
  const shown = stored ? formatLocal(stored) : ''
  // Like TextInput: the box owns what is typed; a new value from outside wins.
  const [text, setText] = useState(shown)
  const [seen, setSeen] = useState(shown)
  // The example is today in this browser's zone: drawn once in the browser, as the server's
  // clock and zone would draw another and the page would hydrate to a mismatch.
  const [example, setExample] = useState<string>()
  useEffect(() => setExample(formatLocal(new Date())), [format])
  if (shown !== seen) (setSeen(shown), setText(shown))
  const [open, setOpen] = useState(false)
  const invalid = text.trim() !== '' && !parseLocal(text)
  // In a document, the unreadable text is reported too: the field's header and the validation
  // list say it, as Sanity's useReportParseError (its wording there). The value stays as stored.
  const docId = useContext(DocIdContext)
  const parseError = invalid ? t('Invalid date. Must be on the format "{format}"', {format}) : null
  useEffect(() => {
    if (!docId) return
    reportParseError(docId, id, parseError)
    return () => reportParseError(docId, id, null)
  }, [docId, id, parseError])
  const button = useRef<HTMLButtonElement>(null)

  // What was typed: empty clears, a date commits, anything else waits (marked invalid).
  const typed = () => {
    if (text === shown) return
    if (text.trim() === '') return commit(undefined)
    const d = parseLocal(text)
    if (d) commit(d)
  }
  const commit = (picked: Date | undefined) => {
    // Typed, picked or set in the time box: on the time step's grid, as Sanity's (task-08d777306df00a8d).
    const d = picked && !dateOnly ? onTimeStep(picked, options.timeStep) : picked
    const next = d ? formatLocal(d) : ''
    setText(next)
    setSeen(next)
    onChange(d ? (dateOnly ? formatDate(d, STORED_DATE) : d.toISOString()) : undefined)
  }
  // Typed but not committed yet (no Enter, no blur): an unsaved edit. Leaving asks first (B11's
  // prompt), and the leaving commits it when it parses (as a blur would: beforeunload, or the
  // page hidden), so the save, the unload send and this browser's kept edits carry it. Sanity's
  // loses it, unasked.
  const pending = !readOnly && text !== shown
  const latest = useRef(typed)
  latest.current = typed
  useEffect(() => {
    if (!pending) return
    const unsaved = () => true
    const hidden = () => document.visibilityState === 'hidden' && latest.current()
    const leaving = () => latest.current()
    unsavedElsewhere.add(unsaved)
    document.addEventListener('visibilitychange', hidden)
    addEventListener('beforeunload', leaving)
    return () => (unsavedElsewhere.delete(unsaved), document.removeEventListener('visibilitychange', hidden), removeEventListener('beforeunload', leaving))
  }, [pending])

  return (
    <div className="datetime" data-date-only={dateOnly || undefined} data-invalid={invalid || undefined}>
      <div className="datetime-box">
        <input
          id={id}
          className="input"
          autoComplete="off"
          placeholder={placeholder ?? (example && t('e.g. {example}', {example}))}
          value={text}
          readOnly={readOnly}
          autoFocus={autoFocus}
          aria-invalid={invalid || undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => typed()}
          onKeyDown={(e) => e.key === 'Enter' && typed()}
        />
        <button ref={button} type="button" className="icon-btn" aria-label={calendarLabel ?? t('Open calendar')} data-tip={calendarLabel ?? t('Select date')} disabled={readOnly} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <Calendar />
        </button>
      </div>
      {invalid && (
        <p className="field-error" role="alert">
          {t('Not a valid date. Use the format {format}.', {format: formatLocal(new Date(2026, 8, 6, 11, 0))})}
        </p>
      )}
      {open && (
        <DatePicker
          value={stored}
          dateOnly={dateOnly}
          timeStep={options.timeStep}
          min={min}
          notice={notice}
          showZone={showZone}
          onPick={(d) => commit(d)}
          onClose={() => (setOpen(false), button.current?.focus())}
        />
      )}
    </div>
  )
}

// Sanity's popovers shift to stay 4 px inside the window: at 390 px the 362 px calendar would run off the right.
function inside(el: HTMLElement) {
  el.style.removeProperty('translate')
  // No room under the field: above it, as Sanity's (its popover flips), when there is room there.
  const below = el.getBoundingClientRect()
  const field = el.parentElement?.getBoundingClientRect()
  if (field && below.bottom > document.documentElement.clientHeight - 4 && field.top - below.height - 8 >= 0) el.dataset.above = ''
  const r = el.getBoundingClientRect()
  const shift = Math.max(Math.min(0, document.documentElement.clientWidth - 4 - r.right), 4 - r.left)
  if (shift) el.style.translate = `${shift}px 0`
}

function DatePicker({value, dateOnly, timeStep = 1, min, notice, showZone, onPick, onClose}: {value?: Date; dateOnly: boolean; timeStep?: number; min?: Date; notice?: string; showZone?: boolean; onPick: (d: Date) => void; onClose: () => void}) {
  const t = useT()
  const locale = useLocale()
  const [focused, setFocused] = useState(() => value ?? new Date())
  const [year, setYear] = useState(String(focused.getFullYear()))
  const [time, setTime] = useState(value ? `${pad(value.getHours())}:${pad(value.getMinutes())}` : '00:00')
  const root = useRef<HTMLDivElement | null>(null)
  // J43: Tab stays in the picker, Escape closes it, focus goes back to its button.
  const scope = useFocusScope<HTMLDivElement>({trap: true, onDismiss: onClose})
  const grid = useRef<HTMLDivElement>(null)
  const today = new Date()

  useEffect(() => setYear(String(focused.getFullYear())), [focused])
  // Focus lands on the selected (or today's) day, as in Sanity.
  useEffect(() => grid.current?.querySelector<HTMLButtonElement>('[data-focused="true"]')?.focus(), [focused])
  // A click outside closes it.
  useEffect(() => {
    const away = (e: MouseEvent) => root.current && !root.current.contains(e.target as Node) && onClose()
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [onClose])

  const withTime = (d: Date) => {
    const [h, m] = time.split(':').map(Number)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number.isFinite(h) ? h! : 0, Number.isFinite(m) ? m! : 0)
  }
  const pick = (d: Date) => (setFocused(d), onPick(withTime(d)))
  const moveMonth = (delta: number) => setFocused(new Date(focused.getFullYear(), focused.getMonth() + delta, Math.min(focused.getDate(), 28)))

  // Whole weeks from the week's first day on or before the 1st, as many as the month needs.
  const first = new Date(focused.getFullYear(), focused.getMonth(), 1)
  const lead = (first.getDay() - weekStart(locale) + 7) % 7
  const start = addDays(first, -lead)
  const inMonth = new Date(focused.getFullYear(), focused.getMonth() + 1, 0).getDate()
  const days = Array.from({length: Math.ceil((lead + inMonth) / 7) * 7}, (_, i) => addDays(start, i))

  const onGridKey = (e: KeyboardEvent) => {
    const step = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7}[e.key]
    if (step) (e.preventDefault(), setFocused(addDays(focused, step)))
    else if (e.key === 'Enter' || e.key === ' ') (e.preventDefault(), !(min && focused < new Date(min.getFullYear(), min.getMonth(), min.getDate())) && pick(focused))
  }

  return (
    <div
      ref={(el) => {
        root.current = el
        scope(el)
        if (el) inside(el)
      }}
      className="popover datepicker"
      role="dialog"
      aria-label={t('Select date')}
    >
      {notice && (
        <p className="dp-notice" role="alert">
          {notice}
        </p>
      )}
      <div className="dp-head">
        <span className="dp-month">
          <select aria-label={t('Month')} value={focused.getMonth()} onChange={(e) => setFocused(new Date(focused.getFullYear(), Number(e.target.value), Math.min(focused.getDate(), 28)))}>
            {monthNames(locale).map((m, i) => (
              <option key={i} value={i}>
                {m}
              </option>
            ))}
          </select>
          <ChevronDown />
        </span>
        <button type="button" className="icon-btn" aria-label={t('Go to previous year')} onClick={() => moveMonth(-12)}>
          <ChevronLeft />
        </button>
        <input
          className="dp-year"
          inputMode="numeric"
          aria-label={t('Year')}
          value={year}
          onChange={(e) => {
            setYear(e.target.value)
            const y = Number(e.target.value)
            if (/^\d{4}$/.test(e.target.value)) setFocused(new Date(y, focused.getMonth(), Math.min(focused.getDate(), 28)))
          }}
        />
        <button type="button" className="icon-btn" aria-label={t('Go to next year')} onClick={() => moveMonth(12)}>
          <ChevronRight />
        </button>
      </div>
      <div className="dp-grid" ref={grid} onKeyDown={onGridKey}>
        {dayNames(locale).map((d, i) => (
          <span key={i} className="dp-weekday">
            {d}
          </span>
        ))}
        {days.map((d) => {
          const selected = !!value && sameDay(d, value)
          const isFocused = sameDay(d, focused)
          const before = !!min && d < new Date(min.getFullYear(), min.getMonth(), min.getDate())
          return (
            <button
              key={d.toDateString()}
              type="button"
              aria-label={dayLabel(d, locale)}
              aria-pressed={selected}
              data-testid={`calendar-day-${d.toDateString().replaceAll(' ', '-')}`}
              data-outside={d.getMonth() !== focused.getMonth() || undefined}
              data-today={sameDay(d, today) || undefined}
              data-selected={selected || undefined}
              data-focused={isFocused}
              tabIndex={isFocused ? 0 : -1}
              disabled={before}
              onClick={() => pick(d)}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>
      {/* Sanity's date picker ends with a rule and an empty strip; a datetime's holds the time. */}
      {dateOnly && <div className="dp-foot" />}
      {!dateOnly && <div className="dp-foot">
        <span className="dp-time">
          <input
            type="time"
            step={timeStep * 60}
            aria-label={t('Select time')}
            value={time}
            onChange={(e) => {
              setTime(e.target.value)
              const m = /^(\d{1,2}):(\d{2})$/.exec(e.target.value)
              if (m && value && Number(m[1]) < 24 && Number(m[2]) < 60)
                onPick(new Date(value.getFullYear(), value.getMonth(), value.getDate(), Number(m[1]), Number(m[2])))
            }}
            // The stored time is on the step's grid; the box shows it once typing there ends (not per key, so 14:45 can be typed).
            onBlur={() => value && setTime(`${pad(value.getHours())}:${pad(value.getMinutes())}`)}
          />
        </span>
        <button
          type="button"
          className="btn-text"
          onClick={() => {
            const now = new Date()
            // On the time step's grid, as Sanity's picker (15: 11:07 → 11:00).
            now.setMinutes(now.getMinutes() - (now.getMinutes() % timeStep), 0, 0)
            setTime(`${pad(now.getHours())}:${pad(now.getMinutes())}`)
            setFocused(now)
            onPick(now)
          }}
        >
          {t('Set to current time')}
        </button>
        {/* Sanity's schedule calendar names the zone its times are in: this computer's. */}
        {showZone && (
          <span className="dp-zone" title={zoneLongName(localZone())}>
            <EarthGlobe /> {zoneShort(localZone())}
          </span>
        )}
      </div>}
    </div>
  )
}
