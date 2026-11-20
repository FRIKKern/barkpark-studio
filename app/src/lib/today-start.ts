import type {QueryClient, QueryKey} from '@tanstack/react-query'
import {hasToday, resolveToday} from './today.ts'

// G2 (task-a34b8c24295dd488): the one place a new document's values get "$today" resolved.
// edits.ts's draftNew and createDoc call it, so every way to start a document goes through
// it: a "+", a template, a reference field's Create, a reload before the first edit
// (template=…), a singleton's first open. A duplicate opts out: its values are a copy.
//
// The zone is the workspace's, as Barkpark resolves it on an API create. No zone, or a
// locale read that failed: UTC, Barkpark's own fallback (never the editor's zone, which
// would give a different date from the server's). The server render's provisional locale
// (lib/ssr-budget) does not know the zone yet, so a token waits for the real read.

/** The locale read: `localeQuery` in the app; a test passes its own. */
export type LocaleRead = {queryKey: QueryKey; queryFn?: unknown}
type LocaleData = {provisional?: true; timeZone?: string} | undefined

const UTC = 'Etc/UTC'

const zoneOf = (d: LocaleData) => d?.timeZone ?? UTC

/**
 * Hands `put` the new document's `values` with "$today" resolved at `now`: at once when the
 * zone is known (the root loader has read it) or there is no token, else after the locale read.
 */
export function startValues<T>(qc: QueryClient, read: LocaleRead, values: T, put: (values: T) => void, now = new Date()): void {
  if (!hasToday(values)) return put(values)
  const held = qc.getQueryData<LocaleData>(read.queryKey)
  if (held && !held.provisional) return put(resolveToday(values, now, zoneOf(held)))
  void qc
    .fetchQuery({...(read as Parameters<QueryClient['fetchQuery']>[0]), staleTime: 0})
    .then((d) => zoneOf(d as LocaleData), () => UTC)
    .then((zone) => put(resolveToday(values, now, zone)))
}
