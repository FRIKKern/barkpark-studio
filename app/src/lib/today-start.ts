import type {QueryClient, QueryKey} from '@tanstack/react-query'
import {hasToday, resolveToday} from './today.ts'

// G2 (task-a34b8c24295dd488): the one place a new document's values get "$today" resolved.
// edits.ts's draftNew and createDoc call it, so every way to start a document goes through
// it: a "+", a template, a reference field's Create, a reload before the first edit
// (template=…), a singleton's first open, Duplicate (whose values are all `asIs`).
//
// The zone is the workspace's, as Barkpark resolves it on an API create; a workspace with no
// zone reads UTC, Barkpark's own fallback (never the editor's zone). When the zone cannot be
// known (the locale read failed, or the server render's provisional stand-in got no answer
// within ZONE_WAIT_MS, or the browser is offline), the Studio does not guess: the schema's own
// token fields are left out, and Barkpark fills them on create from the same initial values,
// in its zone (it keeps a caller's values over its own, so absent means Barkpark's). A desk
// list's or a template's values exist only here, so those read UTC then.

/** A new document's values, by where they come from. */
export type Start = {
  /** The type's own initialValues: Barkpark has them too, and fills them on create. */
  schema?: Record<string, unknown>
  /** A desk list's initialValues or a studio.config template's: only the Studio has them. */
  local?: Record<string, unknown>
  /** What the person typed (a reference's search text), or a copy: never resolved. */
  asIs?: Record<string, unknown>
}

/** The locale read: `localeQuery` in the app; a test passes its own. */
export type LocaleRead = {queryKey: QueryKey; queryFn?: unknown}
type LocaleData = {provisional?: true; zoneUnknown?: true; timeZone?: string} | undefined

const UTC = 'Etc/UTC'

/** How long a new document waits for the real locale read: then it opens with the fallback. */
export const zoneWait = {ms: 2000}

/** The workspace's zone (UTC when it has none), or null when it cannot be known. */
const zoneOf = (d: LocaleData): string | null => (!d || d.provisional || d.zoneUnknown ? null : (d.timeZone ?? UTC))

/** `start` merged (schema, then local, then asIs) with "$today" resolved in `zone`. */
export function startedWith(start: Start, zone: string | null, now: Date): Record<string, unknown> {
  const {schema = {}, local = {}, asIs = {}} = start
  const own = zone ? resolveToday(schema, now, zone) : Object.fromEntries(Object.entries(schema).filter(([, v]) => !hasToday(v)))
  return {...own, ...resolveToday(local, now, zone ?? UTC), ...asIs}
}

/**
 * Hands `put` the new document's values: at once when the zone is known (the root loader
 * has read it) or nothing holds a token; else after the locale read, or `zoneWait.ms`.
 */
export function startValues(qc: QueryClient, read: LocaleRead, start: Start, put: (values: Record<string, unknown>) => void, now = new Date()): void {
  if (!hasToday(start.schema) && !hasToday(start.local)) return put(startedWith(start, UTC, now))
  const held = qc.getQueryData<LocaleData>(read.queryKey)
  if (held && !held.provisional) return put(startedWith(start, zoneOf(held), now))
  const answer = qc.fetchQuery({...(read as Parameters<QueryClient['fetchQuery']>[0]), staleTime: 0, retry: false}).then((d) => zoneOf(d as LocaleData), () => null)
  const late = new Promise<null>((go) => setTimeout(go, zoneWait.ms, null))
  void Promise.race([answer, late]).then((zone) => put(startedWith(start, zone, now)))
}
