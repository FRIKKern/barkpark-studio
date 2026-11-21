// "$today" in initial values (G2, task-a34b8c24295dd488): Sanity's
// `initialValue: () => new Date()`, as data. Barkpark serves the token as written
// (barkpark docs/contracts/initial-values.md) and resolves it the same way on an API
// create (api/lib/barkpark/content/today.ex); fixtures/today-cases.json holds its
// answers and today-server.test.ts checks this file gives the same.
//
// Only the exact string is a token. "$today" is today's date (YYYY-MM-DD) on any field,
// "$today.year" the year, both in the zone; a zone Intl does not know reads UTC.

const TOKEN = '$today'
const YEAR_TOKEN = '$today.year'

const formats = new Map<string, Intl.DateTimeFormat>()

/** Today's date in `zone` as YYYY-MM-DD. */
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

/** Whether `v` holds a token anywhere. */
export function hasToday(v: unknown): boolean {
  if (v === TOKEN || v === YEAR_TOKEN) return true
  if (Array.isArray(v)) return v.some(hasToday)
  return !!v && typeof v === 'object' && Object.values(v).some(hasToday)
}

function walk(v: unknown, now: Date, zone: string): unknown {
  if (v === TOKEN) return dateIn(now, zone)
  if (v === YEAR_TOKEN) return String(Number(dateIn(now, zone).slice(0, 4)))
  if (Array.isArray(v)) return v.map((x) => walk(x, now, zone))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, now, zone)]))
  return v
}

/**
 * `value` with "$today" resolved at `now` in `zone` (the workspace's; lib/today-start picks
 * it). No token: the same value, untouched.
 */
export function resolveToday<T>(value: T, now: Date, zone: string): T {
  return hasToday(value) ? (walk(value, now, zone) as T) : value
}
