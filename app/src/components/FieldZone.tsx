import {useContext, useEffect, useState, useSyncExternalStore} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {EarthAmericas} from './icons'
import {toast} from './Toasts'
import {ZoneDialog} from './ZoneDialog'
import {DocIdContext} from './doc-ids'
import {useT} from '../lib/i18n'
import {getPref, putPref} from '../lib/prefs'
import {fieldZoneName, zoneEntry, zoneKey, zoneOptions, zoneScope, type ZoneOptions} from '../lib/field-zone'
import '../field-zone.css'

// A datetime field's time zone, as Sanity's (task-a9e1da2562bec7a4): the button after the field's
// title (TimeZoneButton) and the zone the box shows and reads (DateTimeInput's useTimeZone). The pick
// is kept per editor on Barkpark (lib/prefs) under Sanity's key, studio.timezone.input.<doc>.<field>,
// mirrored in this browser for the first paint and as the stand-in when Barkpark keeps no prefs.
// Picking a zone writes nothing to the document: the stored instant stays as it is.

// The picks this browser knows, by key, shared by the button and its box (and the field in another pane).
const picks = new Map<string, string | null>()
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  if (listeners.size === 1) addEventListener('storage', fromOtherTab)
  return () => (listeners.delete(l), listeners.size || removeEventListener('storage', fromOtherTab))
}
function fromOtherTab(e: StorageEvent) {
  if (!e.key?.startsWith('studio.timezone.input.')) return
  picks.set(e.key, mirrored(e.newValue))
  notify()
}
const mirrored = (raw: string | null) => {
  try {
    const zone = JSON.parse(raw ?? 'null') as unknown
    return typeof zone === 'string' ? zone : null
  } catch {
    return null
  }
}
function picked(key: string) {
  if (!picks.has(key)) {
    let raw: string | null = null
    try {
      raw = localStorage.getItem(key)
    } catch {}
    picks.set(key, mirrored(raw))
  }
  return picks.get(key) ?? null
}
const chosenHere = new Set<string>()
function keep(key: string, zone: string) {
  picks.set(key, zone)
  chosenHere.add(key)
  try {
    localStorage.setItem(key, JSON.stringify(zone))
  } catch {}
  notify()
  // Barkpark keeps a JSON object per key (a bare string is refused): the zone rides as {zone}.
  void putPref({data: {key, value: {zone}}}).catch(() => {})
}

/** The zone a datetime field shows (undefined: none of its own, local time as before), and how to pick another. */
export function useFieldZone(path: string, options: unknown, value: unknown) {
  const docId = useContext(DocIdContext)
  const o = zoneOptions(options as ZoneOptions | undefined)
  const on = !!docId && o.button
  const key = on ? zoneKey(zoneScope(docId, path, o.allowSwitch)) : undefined
  // With switching off nothing is ever picked: the .fixed key is Sanity's, so an old pick doesn't count.
  const remembered = on && o.allowSwitch ? key : undefined
  const local = useSyncExternalStore(subscribe, () => (remembered ? picked(remembered) : null), () => null)
  // The editor's pick from Barkpark (another browser's), unless they picked here already.
  const qc = useQueryClient()
  const {data: kept} = useQuery({
    queryKey: ['pref', remembered],
    queryFn: async () => ((await getPref({data: remembered!}).catch(() => null)) as {zone?: unknown} | null)?.zone ?? null,
    enabled: !!remembered,
    staleTime: 60_000,
  })
  useEffect(() => {
    if (!remembered || chosenHere.has(remembered) || typeof kept !== 'string' || kept === picked(remembered)) return
    picks.set(remembered, kept)
    try {
      localStorage.setItem(remembered, JSON.stringify(kept))
    } catch {}
    notify()
  }, [remembered, kept])
  const zone = on ? fieldZoneName(local, o.display) : undefined
  const at = typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value) : undefined
  return {zone, at, button: on, allowSwitch: o.allowSwitch, pick: (next: string) => key && (keep(key, next), qc.setQueryData(['pref', key], next))}
}

/** Sanity's time zone button, after a datetime field's title: its zone's city; a click opens "Select time zone". */
export function FieldZone({field, path, value}: {field: {type: string; name: string; title?: string; options?: unknown}; path: string; value: unknown}) {
  if (field.type !== 'datetime') return null
  return <ZoneButton field={field} path={path} value={value} />
}

function ZoneButton({field, path, value}: {field: {name: string; title?: string; options?: unknown}; path: string; value: unknown}) {
  const t = useT()
  const z = useFieldZone(path, field.options, value)
  const [open, setOpen] = useState(false)
  // Named in the browser's language and zone, so only once in the browser (hydration: the server's would differ).
  const [named, setNamed] = useState(false)
  useEffect(() => setNamed(true), [])
  if (!z.button || !z.zone) return null
  const entry = named ? zoneEntry(z.zone, z.at) : undefined
  const tip = entry && t('Displaying {title} in {alternativeName} GMT{offset}', {title: field.title ?? field.name, alternativeName: entry.alternativeName, offset: entry.offset})
  const label = (
    <>
      <EarthAmericas /> <span className="field-zone-city">{entry?.city}</span>
    </>
  )
  if (!z.allowSwitch)
    return (
      <span className="field-zone" data-fixed="" data-tip={tip} data-testid="timezone-fixed">
        {label}
      </span>
    )
  return (
    <>
      <button type="button" className="field-zone" data-testid="timezone-button" aria-haspopup="dialog" aria-label={entry && `${t('Time zone')}: ${entry.alternativeName} (${entry.namePretty})`} data-tip={tip} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <ZoneDialog
          zone={z.zone}
          at={z.at}
          info={t('The selected time zone will change how dates are represented only for this input in this document.')}
          onClose={() => setOpen(false)}
          onPick={(next) => {
            z.pick(next)
            setOpen(false)
            const e = zoneEntry(next, z.at)
            toast({title: t('Time zone updated'), description: `${e.alternativeName} (${e.namePretty})`}, 15_000)
          }}
        />
      )}
    </>
  )
}
