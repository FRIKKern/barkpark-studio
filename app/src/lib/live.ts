import {useEffect} from 'react'
import {notifyManager, useQueryClient, type QueryClient} from '@tanstack/react-query'
import type {Doc} from './data'
import {applyServer} from './edits'
import {listenTo, onStream, position} from './stream'

type Frame = {documentId: string; type: string; mutation: string; result: Doc | null}

/**
 * Keep open panes live: the docs and list types on screen, on the tab's one stream (lib/stream.ts).
 * Each frame carries the document as it now reads (draft over published), so it
 * goes into the cache (under any unsent local edits); deletes and discards refetch.
 */
let fleetTimer: ReturnType<typeof setTimeout> | undefined
let backlinksTimer: ReturnType<typeof setTimeout> | undefined
const undrawn: (() => void)[] = [] // e2e: __holdRenders

// A page rendered on the server read its data before its stream opened. The
// server says where to resume from (its listen position as of that read); when it
// was not listening yet (null), the page reads what is on screen again once connected.
let readAgain = false
let resumed = false
export function resumeLive(mark: number | null | undefined) {
  if (typeof window === 'undefined' || mark === undefined || resumed) return
  resumed = true
  if (mark === null) readAgain = true
  else (position.lastSeen = String(mark)), (position.fromRender = true)
}

// The frames go into the cache of the tab's QueryClient (one per tab), heard once.
let heardBy: QueryClient | null = null
function hear(qc: QueryClient) {
  if (heardBy === qc) return
  heardBy = qc
  onStream('mutation', (e) => onFrame(qc, e))
  // The server lost track of where we were: refetch what is on screen.
  onStream('reset', () => void qc.invalidateQueries())
  onStream('welcome', (e) => {
    if (e.lastEventId && !position.lastSeen) position.lastSeen = e.lastEventId
    if (readAgain) (readAgain = false), void qc.invalidateQueries()
  })
  if (typeof window === 'undefined') return
  // e2e probe: read everything again, as a reconnect that lost its place does.
  ;(window as {__readAll?: () => void}).__readAll = () => void qc.invalidateQueries()
  // e2e probe: what reaches the cache stays off the screen until released, as on a busy machine.
  ;(window as {__holdRenders?: (on: boolean) => void}).__holdRenders = (on) => {
    notifyManager.setScheduler(on ? (cb) => void undrawn.push(cb) : (cb) => setTimeout(cb, 0))
    if (!on) undrawn.splice(0).forEach((cb) => cb())
  }
}

export function useLive(ids: string[], types: string[]) {
  const qc = useQueryClient()
  const key = `ids=${[...new Set(ids)].sort().join(',')}&types=${[...new Set(types)].sort().join(',')}`
  const empty = ids.length + types.length === 0
  useEffect(() => {
    if (empty) return
    hear(qc)
    return listenTo([...new Set(ids)], [...new Set(types)])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is ids and types
  }, [key, empty, qc])
}

const onFrame = (qc: QueryClient, e: MessageEvent) => {
  const f = JSON.parse(e.data) as Frame
  ;(window as {__liveFrames?: string[]}).__liveFrames?.push(`${position.lastSeen}|${f.documentId}`) // e2e probe
  // J40: a comment changed somewhere: the comment threads read again.
  if (f.type === 'studioComment') return void qc.invalidateQueries({queryKey: ['comments']})
  // J66: a task changed: the Tasks sidebar reads again.
  if (f.type === 'studioTask') return void qc.invalidateQueries({queryKey: ['tasks']})
  // D14: a task changed: papers' task previews read again (debounced: a bulk
  // edit is one read).
  if (f.type === 'task') return void (clearTimeout(fleetTimer), (fleetTimer = setTimeout(() => void qc.invalidateQueries({queryKey: ['fleet']}), 400)))
  const id = f.documentId.replace(/^drafts\./, '')
  // A change to the published row itself (publish, unpublish, direct write).
  if (!f.documentId.startsWith('drafts.')) {
    void qc.invalidateQueries({queryKey: ['doc-published', id]})
    void qc.invalidateQueries({queryKey: ['list-published', f.type]})
  }
  // J17: who refers to what may have changed: open Incoming references panels read again,
  // once per burst. Barkpark's edges are right as the write returns (#22591), so one read
  // does; a doc pointing away still leaves the panel from the frame's doc (IncomingReferences).
  clearTimeout(backlinksTimer)
  backlinksTimer = setTimeout(() => void qc.invalidateQueries({queryKey: ['backlinks']}), 150)
  // A delete or a discard carries the document it removed: read again, never apply it
  // (a replayed discardDraft put a dead draft back on screen, J36 flake 2026-10-09).
  if (!f.result || f.mutation === 'delete' || f.mutation === 'discardDraft') {
    void qc.invalidateQueries({queryKey: ['doc', id]})
    void qc.invalidateQueries({queryKey: ['list', f.type]})
    return
  }
  applyServer(qc, f.result)
}
