// Sanity's date and time formats (moment tokens) for the date and datetime inputs:
// options.dateFormat (default YYYY-MM-DD) and options.timeFormat (default HH:mm).
// Only the tokens a date or a time of day needs; anything else, and [bracketed] text, is literal.

const TOKENS = /\[[^\]]*\]|YYYY|YY|MMM|MM|M|DD|D|HH|H|hh|h|mm|m|A|a/g
// MMM: the month's short English name, as Sanity's schedule dialog writes it (Oct 16, 2026).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** A wall-clock time: the fields a clock and calendar show (month 1-12), in no zone of its own. */
export type Wall = {year: number; month: number; day: number; hour: number; minute: number}

/** `d` (local time) in `format`. */
export const formatDate = (d: Date, format: string): string =>
  formatWall({year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes()}, format)

/** A wall time in `format` (lib/field-zone: a time in a zone that is not this computer's). */
export function formatWall(w: Wall, format: string): string {
  const h12 = w.hour % 12 || 12
  const parts: Record<string, string> = {
    YYYY: String(w.year), YY: pad(w.year % 100), MMM: MONTHS[w.month - 1]!, MM: pad(w.month), M: String(w.month),
    DD: pad(w.day), D: String(w.day), HH: pad(w.hour), H: String(w.hour), hh: pad(h12), h: String(h12),
    mm: pad(w.minute), m: String(w.minute), A: w.hour < 12 ? 'AM' : 'PM', a: w.hour < 12 ? 'am' : 'pm',
  }
  return format.replace(TOKENS, (t) => (t.startsWith('[') ? t.slice(1, -1) : parts[t]!))
}

/** `text` read in `format` (local time); undefined if it isn't one, or names a day that doesn't exist. */
export function parseDate(text: string, format: string): Date | undefined {
  const w = parseWall(text, format)
  return w && new Date(w.year, w.month - 1, w.day, w.hour, w.minute)
}

/** `text` read in `format` as a wall time, in no zone; undefined if it isn't one, or names a day or time that doesn't exist. */
export function parseWall(text: string, format: string): Wall | undefined {
  const fields: string[] = []
  const source = format.replace(/[.*+?^${}()|\\]/g, '\\$&').replace(/\\\[[^\]]*\]|\[[^\]]*\]|YYYY|YY|MMM|MM|M|DD|D|HH|H|hh|h|mm|m|A|a/g, (t) => {
    if (t.startsWith('[') || t.startsWith('\\[')) return t.replace(/^\\?\[|\]$/g, '').replace(/[.*+?^${}()|\\]/g, '\\$&')
    fields.push(t)
    return t === 'YYYY' ? '(\\d{4})' : t === 'MMM' ? '([A-Za-z]{3})' : t === 'A' || t === 'a' ? '([AaPp][Mm])' : '(\\d{1,2})'
  })
  const m = new RegExp(`^\\s*${source}\\s*$`).exec(text)
  if (!m) return undefined
  let y = 1970, mo = 1, d = 1, h = 0, mi = 0, pm: boolean | undefined
  fields.forEach((f, i) => {
    const v = m[i + 1]!
    const n = Number(v)
    if (f === 'YYYY') y = n
    else if (f === 'YY') y = 2000 + n
    else if (f === 'MMM') mo = MONTHS.findIndex((x) => x.toLowerCase() === v.toLowerCase()) + 1
    else if (f === 'MM' || f === 'M') mo = n
    else if (f === 'DD' || f === 'D') d = n
    else if (f === 'HH' || f === 'H' || f === 'hh' || f === 'h') h = n
    else if (f === 'mm' || f === 'm') mi = n
    else pm = /p/i.test(v)
  })
  if (pm !== undefined) h = (h % 12) + (pm ? 12 : 0)
  // Read in UTC, which skips no hour: only the calendar can refuse (31 April, 29 February 2027).
  const day = new Date(Date.UTC(y, mo - 1, d))
  return day.getUTCMonth() === mo - 1 && day.getUTCDate() === d && h < 24 && mi < 60 ? {year: y, month: mo, day: d, hour: h, minute: mi} : undefined
}

/** `d` down to the time step's grid (minutes), as Sanity's enforceTimeStep: every value a
 *  datetime input writes, typed or picked (15: 09:07 → 09:00). No step, or 1, keeps the minute. */
export function onTimeStep(d: Date, step = 1): Date {
  const over = step > 1 ? d.getMinutes() % step : 0
  if (!over) return d
  const out = new Date(d)
  out.setMinutes(d.getMinutes() - over)
  return out
}
