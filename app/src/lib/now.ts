import {queryOptions, useQuery} from '@tanstack/react-query'
import {useSyncExternalStore} from 'react'

// Relative times ("Last published 1 min. ago") are worked out on the server and again as
// the page hydrates; across a unit (1 min. vs 56 sec.) they differed and React regenerated
// the footer (task-232142bd0341db2c). They read this clock instead: the server's render time
// (loaded by the root route, so it rides in the dehydrated cache) until the browser's first
// 30 s tick, then the browser's. The hydrating render matches the server's, and nothing swaps.

/** When the server rendered the page. */
export const serverNowQuery = queryOptions({queryKey: ['server-now'], queryFn: () => Date.now(), staleTime: Infinity, gcTime: Infinity})

const loaded = Date.now()
let clock: number | null = null
const listeners = new Set<() => void>()
let ticking = false
function subscribe(listener: () => void) {
  listeners.add(listener)
  // One page-wide tick, never stopped: a footer mounted later reads a clock at most 30 s old.
  if (!ticking) (ticking = true), setInterval(() => ((clock = Date.now()), listeners.forEach((l) => l())), 30_000)
  return () => void listeners.delete(listener)
}

/** Now, for a relative time: the server's render time until the first tick, then the browser's, every 30 s. */
export function useNow(): number {
  const rendered = useQuery(serverNowQuery).data ?? loaded
  return useSyncExternalStore(subscribe, () => clock ?? rendered, () => rendered)
}

const noChange = () => () => {}
let browserZone: string | undefined
/**
 * The zone a date is read in: UTC on the server and while the page hydrates (both sides draw
 * the same words, as #898 and #902 keep them), then the browser's own, at once after.
 */
export function useZone(): string {
  return useSyncExternalStore(noChange, () => (browserZone ??= Intl.DateTimeFormat().resolvedOptions().timeZone), () => 'UTC')
}
