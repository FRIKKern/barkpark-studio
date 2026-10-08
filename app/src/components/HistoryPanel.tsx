import {useState, type ReactNode} from 'react'
import {DialogBox} from './FocusScopes'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {historyQuery, restoreRevision, timeline, type HistoryEntry} from '../lib/history'
import {applyServer} from '../lib/edits'
import type {Doc} from '../lib/data'
import {Close as CloseIcon} from './icons'
import {toast} from './Toasts'

// Sanity's History inspector (J16), beside the document: a timeline of what
// happened, who did it and when; picking an entry shows the document as it was
// then, read-only, at a deep URL (`rev=<id>`), with "Revert to revision" in the footer.

const BADGE: Record<string, string> = {Published: 'published', Unpublished: 'unpublished', 'Discarded draft': 'discarded', Deleted: 'discarded', Restored: 'edited', Edited: 'edited', 'Draft created': 'created'}

/** "just now", "29 sec. ago", "12 min. ago", "3 hr. ago", "2 days ago" — Sanity's short relative times. */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${Math.floor(s)} sec. ago`
  if (s < 3600) return `${Math.floor(s / 60)} min. ago`
  if (s < 86_400) return `${Math.floor(s / 3600)} hr. ago`
  const d = Math.floor(s / 86_400)
  return `${d} ${d === 1 ? 'day' : 'days'} ago`
}
const initials = (name: string) => (name === 'API token' ? '·' : name.replace(/@.*/, '').split(/[.\s_-]+/).map((w) => w[0]?.toUpperCase() ?? '').join('').slice(0, 2))

export function HistoryPanel({type, id, selected, onPick, onClose, tab = 'history', onTab, review}: {
  type: string
  id: string
  selected?: string
  onPick: (entry: HistoryEntry | null) => void
  onClose: () => void
  /** History (the timeline) or Review changes (J15, `review`). */
  tab?: 'history' | 'review'
  onTab: (tab: 'history' | 'review') => void
  review: ReactNode
}) {
  const {data: revisions, error} = useQuery({...historyQuery(type, id), refetchInterval: 10_000})
  const entries = revisions ? timeline(revisions) : []
  return (
    <aside className="inspector history" aria-label="History">
      <header>
        <div className="view-tabs" role="tablist" aria-label="Inspector">
          <button type="button" role="tab" aria-selected={tab === 'history'} onClick={() => onTab('history')}>
            History
          </button>
          <button type="button" role="tab" aria-selected={tab === 'review'} onClick={() => onTab('review')}>
            Review changes
          </button>
        </div>
        <button type="button" className="icon-btn" aria-label="Close history" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <div role="tabpanel" aria-label={tab === 'review' ? 'Review changes' : 'History'}>
      {tab === 'review' ? review : <>
      <p className="history-note">
        Showing the history for the <strong>Draft</strong> version of this document.
      </p>
      {error && <p role="alert">Could not load the history: {String(error)}</p>}
      <ul className="history-list" role="listbox" aria-label="Document revisions">
        {entries.map((e, i) => {
          // The newest entry is the document as it is now: picking it leaves the old-revision view.
          const isSelected = selected ? e.revision.id === selected : i === 0
          const name = `${e.revision.author} ${e.label} ${ago(e.revision.timestamp)}`
          return (
            <li key={e.revision.id} role="option" aria-selected={isSelected} aria-label={name}>
              <button type="button" onClick={() => onPick(i === 0 ? null : e)}>
                <span className="avatar" title={e.revision.author}>
                  {initials(e.revision.author)}
                  <span className="badge" data-kind={BADGE[e.label] ?? 'edited'} />
                </span>
                <span className="history-text">
                  <span>{e.label}</span>
                  <time dateTime={e.revision.timestamp} title={new Date(e.revision.timestamp).toLocaleString()}>
                    {ago(e.revision.timestamp)}
                  </time>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      </>}
      </div>
    </aside>
  )
}

/** Sanity's revision date: "Oct 6, 2026 @ 2:29:19 AM". */
export const revisionDate = (iso: string) => {
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'})} @ ${d.toLocaleTimeString('en-US')}`
}

/**
 * Footer while an old revision is shown, after Sanity's: when it is from, and
 * "Revert to revision", which asks first and then writes it back as the draft.
 */
export function RevisionFooter({type, revisionId, timestamp, onRestored}: {type: string; revisionId: string; timestamp?: string; onRestored: () => void}) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const revert = async () => {
    setBusy(true)
    try {
      const doc = (await restoreRevision({data: {id: revisionId, type}})) as unknown as Doc
      applyServer(qc, doc)
      void qc.invalidateQueries({queryKey: ['history', doc._publishedId]})
      setAsking(false)
      onRestored()
    } catch (err) {
      toast({tone: 'critical', title: 'Could not restore this revision', description: (err as Error).message})
    } finally {
      setBusy(false)
    }
  }
  return (
    <footer className="doc-footer revision-footer">
      <span className="save-state" role="status">
        Revision from <strong>{timestamp ? revisionDate(timestamp) : '…'}</strong>
      </span>
      <div className="menu-wrap">
        <button className="publish caution" disabled={busy} aria-expanded={asking} onClick={() => setAsking((a) => !a)}>
          Revert to revision
        </button>
        {asking && (
          <DialogBox className="popover confirm up" aria-label="Restore this document?" onClose={() => setAsking(false)}>
            <p>Are you sure you want to restore this document?</p>
            <div className="confirm-actions">
              <button type="button" className="btn" autoFocus onClick={() => setAsking(false)}>
                Cancel
              </button>
              <button type="button" className="btn danger" disabled={busy} onClick={revert}>
                Confirm
              </button>
            </div>
          </DialogBox>
        )}
      </div>
    </footer>
  )
}
