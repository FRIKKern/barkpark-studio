import {useEffect} from 'react'
import {useQueryClient} from '@tanstack/react-query'
import type {Doc} from './data'
import {applyServer} from './edits'
import {setLiveDown} from './connection'

type Frame = {documentId: string; type: string; mutation: string; result: Doc | null}

/**
 * Keep open panes live: one EventSource for the docs and list types on screen.
 * Each frame carries the document as it now reads (draft over published), so it
 * goes into the cache (under any unsent local edits); deletes and discards refetch.
 */
// The newest frame this page has applied: a subscription opened after navigating
// asks the server for everything since, so nothing falls between two streams.
let lastSeen: string | null = null

// A page rendered on the server read its data before its stream opened. The
// server says where to resume from (its listen position as of that read); when it
// was not listening yet (null), the page reads what is on screen again once connected.
let readAgain = false
let resumed = false
export function resumeLive(mark: number | null | undefined) {
  if (typeof window === 'undefined' || mark === undefined || resumed) return
  resumed = true
  if (mark === null) readAgain = true
  else lastSeen = String(mark)
}

export function useLive(ids: string[], types: string[]) {
  const qc = useQueryClient()
  const key = `ids=${[...new Set(ids)].sort().join(',')}&types=${[...new Set(types)].sort().join(',')}`
  const empty = ids.length + types.length === 0
  useEffect(() => {
    if (empty) return
    let es: EventSource
    let stopped = false
    let retry: ReturnType<typeof setTimeout> | undefined
    const open = () => {
      es = new EventSource(`/api/listen?${key}${lastSeen ? `&since=${lastSeen}` : ''}`)
      // EventSource retries a dropped stream by itself (sending Last-Event-ID); one
      // it gave up on (CLOSED) is reopened here with ?since=.
      es.onerror = () => {
        setLiveDown(true) // J50: "Trying to connect…" if it stays down
        if (es.readyState === EventSource.CLOSED && !stopped) retry = setTimeout(open, 1000)
      }
      // The server lost track of where we were: refetch what is on screen.
      es.addEventListener('reset', () => void qc.invalidateQueries())
      es.addEventListener('welcome', (e) => {
        setLiveDown(false)
        if ((e as MessageEvent).lastEventId && !lastSeen) lastSeen = (e as MessageEvent).lastEventId
        if (readAgain) (readAgain = false), void qc.invalidateQueries()
      })
      es.addEventListener('mutation', onFrame)
    }
    // e2e probe: cut the stream for `ms`, as a dead network would.
    ;(window as {__dropLive?: (ms: number) => void}).__dropLive = (ms) => (es.close(), (retry = setTimeout(open, ms)))
    const onFrame = (e: Event) => {
      if ((e as MessageEvent).lastEventId) lastSeen = (e as MessageEvent).lastEventId
      const f = JSON.parse((e as MessageEvent).data) as Frame
      ;(window as {__liveFrames?: string[]}).__liveFrames?.push(`${lastSeen}|${f.documentId}`) // e2e probe
      // J40: a comment changed somewhere: the comment threads read again.
      if (f.type === 'studioComment') return void qc.invalidateQueries({queryKey: ['comments']})
      const id = f.documentId.replace(/^drafts\./, '')
      // A change to the published row itself (publish, unpublish, direct write).
      if (!f.documentId.startsWith('drafts.')) {
        void qc.invalidateQueries({queryKey: ['doc-published', id]})
        void qc.invalidateQueries({queryKey: ['list-published', f.type]})
      }
      if (!f.result || f.mutation === 'delete') {
        void qc.invalidateQueries({queryKey: ['doc', id]})
        void qc.invalidateQueries({queryKey: ['list', f.type]})
        return
      }
      applyServer(qc, f.result)
    }
    open()
    return () => {
      stopped = true
      setLiveDown(false)
      clearTimeout(retry)
      es.close()
    }
  }, [key, empty, qc])
}
