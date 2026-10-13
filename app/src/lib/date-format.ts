// Sanity's date and time formats (moment tokens) for the date and datetime inputs:
// options.dateFormat (default YYYY-MM-DD) and options.timeFormat (default HH:mm).
// Only the tokens a date or a time of day needs; anything else, and [bracketed] text, is literal.

const TOKENS = /\[[^\]]*\]|YYYY|YY|MM|M|DD|D|HH|H|hh|h|mm|m|A|a/g
const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** `d` (local time) in `format`. */
export function formatDate(d: Date, format: string): string {
  const h12 = d.getHours() % 12 || 12
  const parts: Record<string, string> = {
    YYYY: String(d.getFullYear()), YY: pad(d.getFullYear() % 100), MM: pad(d.getMonth() + 1), M: String(d.getMonth() + 1),
    DD: pad(d.getDate()), D: String(d.getDate()), HH: pad(d.getHours()), H: String(d.getHours()), hh: pad(h12), h: String(h12),
    mm: pad(d.getMinutes()), m: String(d.getMinutes()), A: d.getHours() < 12 ? 'AM' : 'PM', a: d.getHours() < 12 ? 'am' : 'pm',
  }
  return format.replace(TOKENS, (t) => (t.startsWith('[') ? t.slice(1, -1) : parts[t]!))
}

/** `text` read in `format` (local time); undefined if it isn't one, or names a day that doesn't exist. */
export function parseDate(text: string, format: string): Date | undefined {
  const fields: string[] = []
  const source = format.replace(/[.*+?^${}()|\\]/g, '\\$&').replace(/\\\[[^\]]*\]|\[[^\]]*\]|YYYY|YY|MM|M|DD|D|HH|H|hh|h|mm|m|A|a/g, (t) => {
    if (t.startsWith('[') || t.startsWith('\\[')) return t.replace(/^\\?\[|\]$/g, '').replace(/[.*+?^${}()|\\]/g, '\\$&')
    fields.push(t)
    return t === 'YYYY' ? '(\\d{4})' : t === 'A' || t === 'a' ? '([AaPp][Mm])' : '(\\d{1,2})'
  })
  const m = new RegExp(`^\\s*${source}\\s*$`).exec(text)
  if (!m) return undefined
  let y = 1970, mo = 1, d = 1, h = 0, mi = 0, pm: boolean | undefined
  fields.forEach((f, i) => {
    const v = m[i + 1]!
    const n = Number(v)
    if (f === 'YYYY') y = n
    else if (f === 'YY') y = 2000 + n
    else if (f === 'MM' || f === 'M') mo = n
    else if (f === 'DD' || f === 'D') d = n
    else if (f === 'HH' || f === 'H' || f === 'hh' || f === 'h') h = n
    else if (f === 'mm' || f === 'm') mi = n
    else pm = /p/i.test(v)
  })
  if (pm !== undefined) h = (h % 12) + (pm ? 12 : 0)
  const date = new Date(y, mo - 1, d, h, mi)
  return date.getMonth() === mo - 1 && date.getDate() === d && h < 24 && mi < 60 ? date : undefined
}
