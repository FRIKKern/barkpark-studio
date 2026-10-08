import {useState} from 'react'
import {useQueryClient} from '@tanstack/react-query'
import type {Doc} from '../lib/data'
import {publish, reasonOf, unpublish} from '../lib/edits'
import {bulkSummary, isWall, type Outcome} from '../lib/bulk'
import {useCanWrite} from '../lib/session'
import {UnpublishDialog} from './UnpublishDialog'
import {toast} from './Toasts'

// B03: the list pane's bulk bar, after LiveView's floating bulk action bar: "N selected",
// Publish selected, Unpublish selected, Clear. Each doc goes on its own (one refusal
// never stops the rest); one summary says what happened.

export function BulkBar({picked, onClear}: {picked: Doc[]; onClear: () => void}) {
  const qc = useQueryClient()
  const {canWrite, publishReason} = useCanWrite()
  const [running, setRunning] = useState<{action: 'publish' | 'unpublish'; at: number} | null>(null)
  const [confirming, setConfirming] = useState(false)
  const run = async (action: 'publish' | 'unpublish') => {
    const outcomes: Outcome[] = []
    for (const [i, doc] of picked.entries()) {
      setRunning({action, at: i + 1})
      // Nothing to do: publishing a doc with no draft, unpublishing one never published.
      if (action === 'publish' ? !doc._draft : doc._hasPublished === false) {
        outcomes.push({kind: 'skipped'})
        continue
      }
      try {
        await (action === 'publish' ? publish(qc, doc) : unpublish(qc, doc))
        outcomes.push({kind: 'done'})
      } catch (e) {
        const msg = (e as Error).message
        outcomes.push({kind: isWall(msg) ? 'walled' : 'failed', reason: reasonOf(msg) ?? msg})
      }
    }
    setRunning(null)
    toast(bulkSummary(action, outcomes), 8000)
    onClear()
  }
  const n = picked.length
  const reason = publishReason ?? (!canWrite ? 'You cannot change documents here' : undefined)
  return (
    <div className="bulk-bar" role="region" aria-label="Bulk actions">
      <span className="bulk-count" role="status">
        {running ? `${running.action === 'publish' ? 'Publishing' : 'Unpublishing'} ${running.at} of ${n}…` : `${n} selected`}
      </span>
      <button type="button" className="btn-text" disabled={!!running} onClick={onClear}>
        Clear
      </button>
      <div className="bulk-actions">
        <button type="button" className="publish" disabled={!!running || !!reason} title={reason} onClick={() => void run('publish')}>
          Publish selected
        </button>
        <button type="button" className="btn" disabled={!!running || !!reason} title={reason} onClick={() => setConfirming(true)}>
          Unpublish selected
        </button>
      </div>
      {confirming && (
        <UnpublishDialog docs={picked.filter((d) => d._hasPublished !== false)} run={async () => void run('unpublish')} onClose={() => setConfirming(false)} />
      )}
    </div>
  )
}
