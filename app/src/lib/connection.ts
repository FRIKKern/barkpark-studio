import {useEffect, useState, useSyncExternalStore} from 'react'
import {useQueryClient, type Query} from '@tanstack/react-query'
import {stickyToast} from '../components/Toasts'
import {t as translate} from './i18n'
import {useBoundElsewhere} from './session'

// J50: what the studio does when Barkpark (or this server) can't be reached, by
// Sanity's numbers (structure/panes/documentList/useDocumentList.ts): a failed read
// tries again at once, then after 1 s, 2 s, … up to 10 times, then waits for Retry;
// offline it waits for the network. "Trying to connect…" shows after 2 s of that
// (core/hooks/useReconnectingToast.ts).
export const AUTO_RETRIES = 10

/**
 * React Query retry options for a pane's reads. On the server a read fails at once:
 * the page still renders. A 4xx is an answer, not an outage (J49: 403 → no access).
 */
export const paneRetry = {
  retry: (failures: number, error: Error) => typeof window !== 'undefined' && failures < AUTO_RETRIES && !/→ 4\d\d\b/.test(String(error)),
  retryDelay: (failures: number) => (failures - 1) * 1000,
}

// The live stream (lib/live.ts) reports here whether it is connected.
let liveDown = false
const listeners = new Set<() => void>()
export function setLiveDown(down: boolean) {
  if (down === liveDown) return
  liveDown = down
  listeners.forEach((l) => l())
}

/** A read that has failed and is being tried again (or waits for the network). */
const struggling = (q: Query) => q.state.fetchFailureCount > 0 && q.state.fetchStatus !== 'idle'

/** "Trying to connect…" while the live stream is down or a read keeps failing, after 2 s of it. */
export function useReconnectingToast() {
  const qc = useQueryClient()
  const live = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => liveDown,
    () => false,
  )
  const [reads, setReads] = useState(false)
  useEffect(() => {
    const cache = qc.getQueryCache()
    // The cache reports while other components render (a useQuery registering its
    // query): look after that render, never set state inside it.
    let gone = false
    const check = () => queueMicrotask(() => !gone && setReads(cache.getAll().some(struggling)))
    check()
    const unsubscribe = cache.subscribe(check)
    return () => ((gone = true), unsubscribe())
  }, [qc])
  // A bound token in another dataset: nothing will connect, and the pane says why.
  const elsewhere = useBoundElsewhere()
  const down = (live || reads) && !elsewhere
  useEffect(() => {
    if (!down) return
    const t = setTimeout(() => stickyToast('reconnecting', {tone: 'caution', title: translate('Trying to connect…')}), 2000)
    return () => (clearTimeout(t), stickyToast('reconnecting', null))
  }, [down])
}
