import {formatWall, parseWall, type Wall} from './date-format.ts'

// A datetime field's time zone, as Sanity's (sanity 6.17 DateTimeInput, useTimeZone, TimeZoneButton,
// DialogTimeZone; task-a9e1da2562bec7a4). options.displayTimeZone shows and picks the time in that
// zone; options.allowTimeZoneSwitch lets the editor pick another, kept per document field. The value
// stays the UTC instant ("2026-07-01T13:00:00.000Z"): the zone only changes how it is shown and read.
// No date library: the zone's wall time comes from Intl, and a wall time back to its instant by trying
// the zone's offsets around it.

export type ZoneOptions = {displayTimeZone?: unknown; allowTimeZoneSwitch?: unknown}
/** One zone as Sanity's list holds it (its NormalizedTimeZone). */
export type ListedZone = {name: string; city: string; namePretty: string; abbreviation: string; alternativeName: string; offset: string}

const formats = new Map<string, Intl.DateTimeFormat>()
const wallFormat = (zone: string) => {
  let f = formats.get(zone)
  if (!f) formats.set(zone, (f = new Intl.DateTimeFormat('en-US', {timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'})))
  return f
}

/** The wall time of an instant in a zone: 2026-07-01T13:00Z in America/New_York is 2026-07-01 09:00. */
export function wallIn(at: Date, zone: string): Wall & {second: number} {
  const p: Record<string, number> = {}
  for (const x of wallFormat(zone).formatToParts(at)) if (x.type !== 'literal') p[x.type] = Number(x.value)
  return {year: p.year!, month: p.month!, day: p.day!, hour: p.hour! % 24, minute: p.minute!, second: p.second!}
}

const asUtc = (w: Wall & {second?: number}) => Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second ?? 0)
/** The zone's offset from UTC at an instant, in ms (New York in July: -4 h). */
const offsetAt = (t: number, zone: string) => asUtc(wallIn(new Date(t), zone)) - Math.floor(t / 1000) * 1000

/**
 * The instant a wall time names in a zone. A wall time the clocks skip (spring forward: 02:30 in New
 * York on 2026-03-08) moves on by the gap, to 03:30 EDT; one they pass twice (fall back: 01:30 on
 * 2026-11-01) is the first, 01:30 EDT. Both as Sanity's input reads them (its TZDate, @date-fns/tz
 * 1.5, run in every computer zone we tried), and as a native Date reads a local time.
 */
export function instantIn(w: Wall & {second?: number}, zone: string): Date {
  const local = asUtc(w)
  // The offsets a day either side: a zone changes its offset at most once in two days.
  const before = offsetAt(local - 86_400_000, zone)
  const after = offsetAt(local + 86_400_000, zone)
  const fits = [local - before, local - after].filter((t) => offsetAt(t, zone) === local - t).sort((a, b) => a - b)
  return new Date(fits[0] ?? local - before)
}

/** Sanity's isValidTimeZoneString: a name Intl lists. */
export const isZone = (zone: unknown): zone is string => typeof zone === 'string' && allZoneNames().includes(zone)
const allZoneNames = (): string[] => (Intl as {supportedValuesOf?: (k: string) => string[]}).supportedValuesOf?.('timeZone') ?? []

/**
 * What a datetime field's options ask, as Sanity's parseOptions: the zone it shows (an invalid name is
 * dropped, with Sanity's warning), whether the editor may switch (default true), and whether the zone
 * button shows at all (a display zone, or allowTimeZoneSwitch set to true itself).
 */
const warned = new Set<string>()
export function zoneOptions(options: ZoneOptions | undefined) {
  const o = options ?? {}
  const display = isZone(o.displayTimeZone) ? o.displayTimeZone : undefined
  if (o.displayTimeZone && !display && !warned.has(String(o.displayTimeZone)) && warned.add(String(o.displayTimeZone)))
    console.warn(`Invalid time zone "${String(o.displayTimeZone)}" supplied to datetime input, defaulting to local time zone or a previously stored preference`)
  const allowSwitch = o.allowTimeZoneSwitch === undefined ? true : !!o.allowTimeZoneSwitch
  return {display, allowSwitch, button: !!display || o.allowTimeZoneSwitch === true}
}

/** Sanity's getPublishedId: drafts.post-1 and versions.r1.post-1 are post-1. */
export const publishedId = (id: string) => (id.startsWith('drafts.') ? id.slice(7) : id.startsWith('versions.') ? id.split('.').slice(2).join('.') : id)

/** Sanity's sanitizeTimeZoneKeyId: items[_key=="a1"].at reads items.key-a1.at, list[2].at list.idx_2.at. */
export function zoneKeyId(path: string): string {
  const out: string[] = []
  const re = /([^.[\]]+)|\[_key=="([^"]*)"\]|\[(\d+)\]|(\.)/gy
  let m: RegExpExecArray | null
  let at = 0
  while (at < path.length && (m = re.exec(path))) {
    at = re.lastIndex
    if (m[1] !== undefined) out.push(m[1])
    else if (m[2] !== undefined) out.push(`key-${m[2]}`)
    else if (m[3] !== undefined) out.push(`idx_${m[3]}`)
  }
  return at === path.length ? out.join('.') : path.replace(/[[\]="']/g, '-')
}

/** The field's zone scope, as Sanity's: `${publishedId}.${field id}`, and `.fixed` when switching is off. */
export const zoneScope = (docId: string, path: string, allowSwitch: boolean) => `${publishedId(docId)}.${zoneKeyId(path)}${allowSwitch ? '' : '.fixed'}`
/** Where the pick is kept: Sanity's key-value key (studio.timezone.input.<scope>), apart from the Releases tool's studio.timezone.content-releases. */
export const zoneKey = (scope: string) => `studio.timezone.input.${scope}`

// Sanity's offset text: +02:00 reads +2, +05:30 +5:30, +00:00 nothing (the option says "GMT").
function offsetText(zone: string, at: Date) {
  const ms = offsetAt(at.getTime(), zone)
  const m = Math.round(Math.abs(ms) / 60_000)
  if (!m) return ''
  return `${ms < 0 ? '-' : '+'}${Math.floor(m / 60)}${m % 60 ? `:${String(m % 60).padStart(2, '0')}` : ''}`
}
const offsetMinutes = (o: string) => (o.startsWith('-') ? -1 : 1) * o.replace(/^[+-]/, '').split(':').reduce((s, x, i) => s + Number(x || 0) * (i ? 1 : 60), 0)
const zoneName = (zone: string, style: 'short' | 'long', at: Date, locale?: string) =>
  new Intl.DateTimeFormat(locale, {timeZone: zone, timeZoneName: style}).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? ''

/** One zone as Sanity's list names it, at `at`. */
export const zoneEntry = (name: string, at = new Date(), locale?: string): ListedZone => ({
  name, city: name.split('/')[1]!.replaceAll('_', ' '), namePretty: name.replaceAll('_', ' '),
  abbreviation: zoneName(name, 'short', at, locale), alternativeName: zoneName(name, 'long', at, locale), offset: offsetText(name, at),
})
let listed: string[] | undefined
const listedNames = () => (listed ??= allZoneNames().filter((z) => z.includes('/')))

const lists = new Map<string, ListedZone[]>()
/**
 * Sanity's zone list: every Intl zone with a city (a "/" in its name), named at `at` (offsets change
 * over the year: Sanity names them at the field's own date), in the browser's language, ordered by
 * offset. Its city is the name's second part, as Sanity's ("America/Argentina/Salta": Argentina).
 */
export function zoneList(at = new Date(), locale?: string): ListedZone[] {
  const key = `${locale ?? ''}_${at.toISOString().slice(0, 10)}`
  const held = lists.get(key)
  if (held) return held
  const list = listedNames()
    .map((name) => zoneEntry(name, at, locale))
    .sort((a, b) => offsetMinutes(a.offset) - offsetMinutes(b.offset))
  lists.set(key, list)
  return list
}

/** Sanity's search: the query anywhere in "<city> (GMT<offset>) <long name>", any case. */
export const zoneMatches = (z: ListedZone, query: string) => !query || `${z.city} (GMT${z.offset}) ${z.alternativeName}`.toLowerCase().includes(query.toLowerCase())

/** Sanity's getLocalTimeZone: this computer's zone if the list has it, else the first named GMT, else the first. */
export function listedLocal(list: ListedZone[], local = Intl.DateTimeFormat().resolvedOptions().timeZone): ListedZone | undefined {
  return list.find((z) => z.name === local) ?? list.find((z) => z.abbreviation === 'GMT') ?? list[0]
}

/** The zone a field shows, as Sanity's getInitialTimeZone: the editor's pick, else the field's zone, else local (each only if listed). */
export function fieldZone(list: ListedZone[], picked: string | null | undefined, display: string | undefined, local?: string): ListedZone | undefined {
  return (picked ? list.find((z) => z.name === picked) : undefined) ?? (display ? list.find((z) => z.name === display) : undefined) ?? listedLocal(list, local)
}

/** fieldZone by name alone, without naming the whole list (the box needs only the zone). */
export function fieldZoneName(picked: string | null | undefined, display: string | undefined, local = Intl.DateTimeFormat().resolvedOptions().timeZone): string | undefined {
  const names = listedNames()
  return [picked, display, local].find((z) => z && names.includes(z)) ?? listedLocal(zoneList(), local)?.name
}

/** An instant down to the time step's grid in the zone shown (15: 09:07 → 09:00). */
export function onZoneStep(at: Date, step: number | undefined, zone: string): Date {
  const over = step && step > 1 ? wallIn(at, zone).minute % step : 0
  return over ? new Date(at.getTime() - over * 60_000) : at
}

/** An instant as the zone's clock shows it, in `format` (the datetime box). */
export const formatIn = (at: Date, format: string, zone: string) => formatWall(wallIn(at, zone), format)
/** `text` read as the zone's wall time: its instant, or undefined while it doesn't parse. */
export function parseIn(text: string, format: string, zone: string): Date | undefined {
  const w = parseWall(text, format)
  return w && instantIn(w, zone)
}

/** What the box shows for a stored instant, in the zone. */
export const shownIn = (iso: string, format: string, zone: string) => formatIn(new Date(iso), format, zone)
/** What typing `text` in the zone stores: the instant as ISO, on the time step; undefined while it doesn't parse. */
export function typedIn(text: string, format: string, zone: string, step?: number): string | undefined {
  const at = parseIn(text, format, zone)
  return at && onZoneStep(at, step, zone).toISOString()
}
