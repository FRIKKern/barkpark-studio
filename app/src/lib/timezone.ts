// The Releases tool's time zone (task-f8d14f136de4ed6d), as Sanity's: times are stored and
// sent in UTC; the zone picked here only changes how they are shown, in this browser.

const KEY = 'studio.timezone.content-releases' // Sanity's key, so the choice reads the same

export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

export function storedZone(): string {
  try {
    const zone = JSON.parse(localStorage.getItem(KEY) ?? 'null') as string | null
    if (zone && zones().includes(zone)) return zone
  } catch {}
  return localZone()
}

export function storeZone(zone: string) {
  try {
    if (zone === localZone()) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, JSON.stringify(zone))
  } catch {}
}

export const zones = (): string[] => (Intl as {supportedValuesOf?: (k: string) => string[]}).supportedValuesOf?.('timeZone') ?? [localZone()]

const part = (zone: string, style: 'short' | 'long' | 'shortOffset', at = new Date()) =>
  new Intl.DateTimeFormat('en-US', {timeZone: zone, timeZoneName: style}).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? ''

/** "Europe/Oslo" reads "Oslo"; "America/New_York" "New York". */
export const cityOf = (zone: string) => zone.split('/').pop()!.replace(/_/g, ' ')
/** Sanity's button label: "GMT+2 (Europe/Oslo)", "EDT (America/New York)". */
export const zoneLabel = (zone: string, at?: Date) => `${part(zone, 'short', at)} (${zone.replace(/_/g, ' ')})`
/** Its search field's text: "Central European Summer Time (Europe/Oslo)". */
export const zoneLongName = (zone: string, at?: Date) => `${part(zone, 'long', at)} (${zone.replace(/_/g, ' ')})`
/** An option: "New York (GMT-4)" and "Eastern Daylight Time". */
export const zoneOption = (zone: string, at?: Date) => ({city: cityOf(zone), offset: part(zone, 'shortOffset', at), name: part(zone, 'long', at)})
/** The short name a time carries when the zone is not this computer's: "EDT". */
export const zoneShort = (zone: string, at?: Date) => part(zone, 'short', at)

/** The calendar day of an instant in a zone: "2026-10-19". */
export function dayKey(at: Date, zone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(at).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}
