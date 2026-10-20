// Sanity's relative times (useRelativeTime with `minimal` and `useTemporalPhrase`, as its
// footer, status tips, history and comments use them): up to 10 s "just now" (the caller
// words it), then seconds, minutes, hours, days and weeks through Intl's short phrases, a
// day or a week either way in the long ones ("yesterday", "last week"; nb "i går", "forrige
// uke"), and from a month on the date itself ("Sep 5", with the year when it is another).
// The date and the month count are read in `zone` (lib/now.ts useZone: UTC on the server and
// while the page hydrates, the browser's own after), so both sides render the same words.

const rtfs: Record<string, Intl.RelativeTimeFormat> = {}
const dtfs: Record<string, Intl.DateTimeFormat> = {}
const rtf = (tag: string, style: 'short' | 'long') => (rtfs[`${tag}|${style}`] ??= new Intl.RelativeTimeFormat(tag, {style, numeric: 'auto'}))
const dtf = (tag: string, year: boolean, timeZone: string) => (dtfs[`${tag}|${year}|${timeZone}`] ??= new Intl.DateTimeFormat(tag, year ? {month: 'short', day: 'numeric', year: 'numeric', timeZone} : {month: 'short', day: 'numeric', timeZone}))
const partsFmt: Record<string, Intl.DateTimeFormat> = {}
/** [year, month, day, hour, minute, second] of `d` on the wall clock of `timeZone`. */
const wall = (d: Date, timeZone: string) => {
  const p = Object.fromEntries(
    (partsFmt[timeZone] ??= new Intl.DateTimeFormat('en-US', {timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'})).formatToParts(d).map((x) => [x.type, Number(x.value)]),
  )
  return [p.year!, p.month!, p.day!, p.hour!, p.minute!, p.second!]
}

/** Whole calendar months from `then` to `now` on `timeZone`'s calendar (date-fns' differenceInMonths). */
function monthsBetween(then: Date, now: Date, timeZone: string) {
  const [y1, m1, ...rest1] = wall(then, timeZone)
  const [y2, m2, ...rest2] = wall(now, timeZone)
  const later = rest2.findIndex((v, i) => v !== rest1[i])
  return (y2! - y1!) * 12 + (m2! - m1!) - (later >= 0 && rest2[later]! < rest1[later]! ? 1 : 0)
}

/** The phrase for `iso` seen at `now` in a BCP 47 `tag` (dates on `zone`'s calendar), or null for "just now". */
export function relativeTime(iso: string, tag: string, now = Date.now(), zone = 'UTC'): string | null {
  const then = new Date(iso)
  const s = Math.max(0, (now - then.getTime()) / 1000)
  if (s <= 10) return null
  if (monthsBetween(then, new Date(now), zone) > 0) return dtf(tag, wall(then, zone)[0] !== wall(new Date(now), zone)[0], zone).format(then)
  const unit = (count: number, u: Intl.RelativeTimeFormatUnit, longAtOne = false) => rtf(tag, longAtOne && count === 1 ? 'long' : 'short').format(-count, u)
  const days = Math.floor(s / 86_400)
  if (days >= 7) return unit(Math.floor(days / 7), 'week', true)
  if (days) return unit(days, 'day', true)
  if (s >= 3600) return unit(Math.floor(s / 3600), 'hour')
  if (s >= 60) return unit(Math.floor(s / 60), 'minute')
  return unit(Math.floor(s), 'second')
}
