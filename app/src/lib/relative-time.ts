// Sanity's relative times (useRelativeTime with `minimal` and `useTemporalPhrase`, as its
// footer, status tips, history and comments use them): up to 10 s "just now" (the caller
// words it), then seconds, minutes, hours, days and weeks through Intl's short phrases, a
// day or a week either way in the long ones ("yesterday", "last week"; nb "i går", "forrige
// uke"), and from a month on the date itself ("Sep 5", with the year when it is another).

const rtfs: Record<string, Intl.RelativeTimeFormat> = {}
const dtfs: Record<string, Intl.DateTimeFormat> = {}
const rtf = (tag: string, style: 'short' | 'long') => (rtfs[`${tag}|${style}`] ??= new Intl.RelativeTimeFormat(tag, {style, numeric: 'auto'}))
const dtf = (tag: string, year: boolean) => (dtfs[`${tag}|${year}`] ??= new Intl.DateTimeFormat(tag, year ? {month: 'short', day: 'numeric', year: 'numeric'} : {month: 'short', day: 'numeric'}))

/** Whole calendar months from `then` to `now` (date-fns' differenceInMonths). */
function monthsBetween(then: Date, now: Date) {
  let m = (now.getFullYear() - then.getFullYear()) * 12 + now.getMonth() - then.getMonth()
  const at = new Date(then)
  at.setMonth(at.getMonth() + m)
  if (at > now) m--
  return m
}

/** The phrase for `iso` seen at `now` in a BCP 47 `tag`, or null for "just now". */
export function relativeTime(iso: string, tag: string, now = Date.now()): string | null {
  const then = new Date(iso)
  const s = Math.max(0, (now - then.getTime()) / 1000)
  if (s <= 10) return null
  if (monthsBetween(then, new Date(now)) > 0) return dtf(tag, then.getFullYear() !== new Date(now).getFullYear()).format(then)
  const unit = (count: number, u: Intl.RelativeTimeFormatUnit, longAtOne = false) => rtf(tag, longAtOne && count === 1 ? 'long' : 'short').format(-count, u)
  const days = Math.floor(s / 86_400)
  if (days >= 7) return unit(Math.floor(days / 7), 'week', true)
  if (days) return unit(days, 'day', true)
  if (s >= 3600) return unit(Math.floor(s / 3600), 'hour')
  if (s >= 60) return unit(Math.floor(s / 60), 'minute')
  return unit(Math.floor(s), 'second')
}
