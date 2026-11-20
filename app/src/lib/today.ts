// "$today" in initial values (G2, task-a34b8c24295dd488): Sanity's
// `initialValue: () => new Date()`, as data. Barkpark serves the token as written
// (barkpark docs/contracts/initial-values.md) and resolves it the same way on an API
// create (api/lib/barkpark/content/today.ex): this file must give the same answer.
//
// Only the exact string is a token. By the field's type: `date` gets today's date in the
// zone, `datetime` the instant (ISO UTC), any other declared type keeps the text, and a
// key the schema does not declare gets the date. "$today.year" is the year as a string.

type TodayField = {name: string; type: string; fields?: TodayField[]}

const TOKEN = '$today'
const YEAR_TOKEN = '$today.year'

const formats = new Map<string, Intl.DateTimeFormat>()

/** Today's date in `zone` as YYYY-MM-DD; a zone Intl does not know reads UTC, as Barkpark does. */
export function dateIn(now: Date, zone: string): string {
  let f = formats.get(zone)
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'})
    } catch {
      return now.toISOString().slice(0, 10)
    }
    formats.set(zone, f)
  }
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

/** True when `v` holds the exact token anywhere (no token: the values stay the same object). */
function hasToken(v: unknown): boolean {
  if (v === TOKEN || v === YEAR_TOKEN) return true
  if (Array.isArray(v)) return v.some(hasToken)
  return !!v && typeof v === 'object' && Object.values(v).some(hasToken)
}

function resolve(v: unknown, field: TodayField | undefined, now: Date, zone: string): unknown {
  if (v === TOKEN) {
    if (!field || field.type === 'date') return dateIn(now, zone)
    return field.type === 'datetime' ? now.toISOString() : v
  }
  if (v === YEAR_TOKEN) return dateIn(now, zone).slice(0, 4)
  if (Array.isArray(v)) return v.map((x) => resolve(x, undefined, now, zone))
  if (v && typeof v === 'object') return resolveMap(v as Record<string, unknown>, field?.fields, now, zone)
  return v
}

function resolveMap(values: Record<string, unknown>, fields: TodayField[] | undefined, now: Date, zone: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, resolve(v, fields?.find((f) => f.name === k), now, zone)]))
}

/**
 * A new document's starting values with "$today" resolved for `fields` (the type's
 * schema fields), at `now` in `zone`: the workspace's zone, else the editor's own.
 */
export function resolveToday(values: Record<string, unknown>, fields: TodayField[] | undefined, now: Date, zone: string): Record<string, unknown> {
  return hasToken(values) ? resolveMap(values, fields, now, zone) : values
}
