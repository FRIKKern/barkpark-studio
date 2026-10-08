import {useEffect, useRef, useState, type KeyboardEvent} from 'react'
import {useFocusScope} from '../lib/focus-scope'
import {Calendar, ChevronLeft, ChevronRight, ChevronDown} from './icons'
import {intlTag, useLocale, useT, type Locale} from '../lib/i18n'

// Sanity's date-time input (J31): a text field in local time ("2026-09-06 11:00")
// that commits on blur or Enter when it parses (half-typed dates never land), plus a calendar popover — month select, year
// stepper, a day grid driven by the keyboard, a time box and "Set to current time".
// The store keeps ISO UTC, like Sanity's datetime.

const pad = (n: number) => String(n).padStart(2, '0')
export const formatLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`

/** "YYYY-MM-DD HH:mm" (or with a T, or date only) in local time; undefined if it isn't one. */
export function parseLocal(text: string): Date | undefined {
  const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?\s*$/.exec(text)
  if (!m) return undefined
  const [y, mo, d, h = '0', mi = '0'] = m.slice(1).map((x) => x ?? '0') as string[]
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi))
  // Reject roll-overs like 2026-02-31.
  return date.getMonth() === Number(mo) - 1 && date.getDate() === Number(d) && Number(h) < 24 ? date : undefined
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// In Norwegian, the names come from Intl (2023-01: a January that starts on a Sunday).
const monthNames = (locale: Locale) =>
  locale === 'en' ? MONTHS : MONTHS.map((_, i) => new Date(2023, i, 1).toLocaleString(intlTag(locale), {month: 'long'}))
const dayNames = (locale: Locale) =>
  locale === 'en' ? DAYS : DAYS.map((_, i) => new Date(2023, 0, 1 + i).toLocaleString(intlTag(locale), {weekday: 'short'}))
const dayLabel = (d: Date, locale: Locale) =>
  locale === 'en' ? d.toDateString() : d.toLocaleDateString(intlTag(locale), {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'})
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes())

export function DateTimeInput({id, value, onChange, readOnly}: {id: string; value: string | undefined; onChange: (v: unknown) => void; readOnly?: boolean}) {
  const t = useT()
  const stored = value ? new Date(value) : undefined
  const shown = stored ? formatLocal(stored) : ''
  // Like TextInput: the box owns what is typed; a new value from outside wins.
  const [text, setText] = useState(shown)
  const [seen, setSeen] = useState(shown)
  if (shown !== seen) (setSeen(shown), setText(shown))
  const [open, setOpen] = useState(false)
  const invalid = text.trim() !== '' && !parseLocal(text)
  const button = useRef<HTMLButtonElement>(null)

  // What was typed: empty clears, a date commits, anything else waits (marked invalid).
  const typed = () => {
    if (text === shown) return
    if (text.trim() === '') return commit(undefined)
    const d = parseLocal(text)
    if (d) commit(d)
  }
  const commit = (d: Date | undefined) => {
    const next = d ? formatLocal(d) : ''
    setText(next)
    setSeen(next)
    onChange(d?.toISOString())
  }

  return (
    <div className="datetime" data-invalid={invalid || undefined}>
      <div className="datetime-box">
        <input
          id={id}
          className="input"
          autoComplete="off"
          placeholder={t('e.g. {example}', {example: formatLocal(new Date())})}
          value={text}
          readOnly={readOnly}
          aria-invalid={invalid || undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => typed()}
          onKeyDown={(e) => e.key === 'Enter' && typed()}
        />
        <button ref={button} type="button" className="icon-btn" aria-label={t('Select date')} title={t('Select date')} disabled={readOnly} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
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
          onPick={(d) => commit(d)}
          onClose={() => (setOpen(false), button.current?.focus())}
        />
      )}
    </div>
  )
}

function DatePicker({value, onPick, onClose}: {value?: Date; onPick: (d: Date) => void; onClose: () => void}) {
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

  // Whole weeks from the Sunday on or before the 1st, as many as the month needs.
  const first = new Date(focused.getFullYear(), focused.getMonth(), 1)
  const start = addDays(first, -first.getDay())
  const inMonth = new Date(focused.getFullYear(), focused.getMonth() + 1, 0).getDate()
  const days = Array.from({length: Math.ceil((first.getDay() + inMonth) / 7) * 7}, (_, i) => addDays(start, i))

  const onGridKey = (e: KeyboardEvent) => {
    const step = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7}[e.key]
    if (step) (e.preventDefault(), setFocused(addDays(focused, step)))
    else if (e.key === 'Enter' || e.key === ' ') (e.preventDefault(), pick(focused))
  }

  return (
    <div
      ref={(el) => ((root.current = el), scope(el))}
      className="popover datepicker"
      role="dialog"
      aria-label={t('Select date')}
    >
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
              onClick={() => pick(d)}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>
      <div className="dp-foot">
        <span className="dp-time">
          <input
            type="time"
            aria-label={t('Select time')}
            value={time}
            onChange={(e) => {
              setTime(e.target.value)
              const m = /^(\d{1,2}):(\d{2})$/.exec(e.target.value)
              if (m && value && Number(m[1]) < 24 && Number(m[2]) < 60)
                onPick(new Date(value.getFullYear(), value.getMonth(), value.getDate(), Number(m[1]), Number(m[2])))
            }}
          />
        </span>
        <button
          type="button"
          className="btn-text"
          onClick={() => {
            const now = new Date()
            setTime(`${pad(now.getHours())}:${pad(now.getMinutes())}`)
            setFocused(now)
            onPick(now)
          }}
        >
          {t('Set to current time')}
        </button>
      </div>
    </div>
  )
}
