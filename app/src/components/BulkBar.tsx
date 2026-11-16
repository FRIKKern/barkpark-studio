import {useState} from 'react'
import {useQueryClient} from '@tanstack/react-query'
import {schemasQuery, type Doc} from '../lib/data'
import {publish, reasonOf, unpublish} from '../lib/edits'
import {bulkResultSummary, bulkSummary, isWall, type BulkAction, type Outcome, type RowResult} from '../lib/bulk'
import {useCanWrite} from '../lib/session'
import {slugsTakenAmong} from '../lib/slug-unique'
import {UnpublishDialog} from './UnpublishDialog'
import {BulkDialog} from './BulkDialog'
import {toast} from './Toasts'
import {t as tBrowser, useT} from '../lib/i18n'

// B03: the list pane's bulk bar, after LiveView's floating bulk action bar: "N selected",
// Publish selected, Unpublish selected, Clear. Each doc goes on its own (one refusal
// never stops the rest); one summary says what happened. Beyond LiveView's: Duplicate,
// Discard changes and Delete for the selection (BulkDialog: confirm, progress, per-row result).

export function BulkBar({picked, onClear, onKeep}: {picked: Doc[]; onClear: () => void; /** After a bulk dialog: the rows still ticked (left alone or failed); none ends selecting. */ onKeep: (ids: string[]) => void}) {
  const t = useT()
  const qc = useQueryClient()
  const {canWrite, publishReason} = useCanWrite()
  const [running, setRunning] = useState<{action: 'publish' | 'unpublish'; at: number} | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [bulk, setBulk] = useState<BulkAction | null>(null)
  const ended = (results: Map<string, RowResult> | null) => {
    const action = bulk!
    setBulk(null)
    if (!results) return // cancelled: the ticks stay as they were
    toast(bulkResultSummary(action, [...results.values()], tBrowser), 8000)
    // What is still there to act on stays ticked; a row done (or gone) leaves the selection.
    onKeep([...results].filter(([, r]) => r.state === 'failed' || (r.state === 'skipped' && r.why !== 'gone')).map(([id]) => id))
  }
  const run = async (action: 'publish' | 'unpublish') => {
    const outcomes: Outcome[] = []
    // Slugs in use, asked once for all of them (publish asks per doc otherwise). Can't tell: none.
    setRunning({action, at: 1})
    const schemas = qc.getQueryData(schemasQuery.queryKey)
    const latest = picked.filter((d) => d._draft).map((d) => qc.getQueryData<Doc>(['doc', d._publishedId]) ?? d)
    const taken = action === 'publish' ? await slugsTakenAmong(qc, latest, (type) => schemas?.find((x) => x.name === type)).catch(() => new Map<string, string[]>()) : new Map<string, string[]>()
    for (const [i, doc] of picked.entries()) {
      setRunning({action, at: i + 1})
      // Nothing to do: publishing a doc with no draft, unpublishing one never published.
      if (action === 'publish' ? !doc._draft : doc._hasPublished === false) {
        outcomes.push({kind: 'skipped'})
        continue
      }
      const slugs = action === 'publish' && taken.get(doc._publishedId)
      if (slugs) {
        outcomes.push({kind: 'failed', reason: `${slugs.join(', ')}: ${t('Slug is already in use')}`})
        continue
      }
      try {
        await (action === 'publish' ? publish(qc, doc, {slugsChecked: true}) : unpublish(qc, doc))
        outcomes.push({kind: 'done'})
      } catch (e) {
        const msg = (e as Error).message
        outcomes.push({kind: isWall(msg) ? 'walled' : 'failed', reason: reasonOf(msg) ?? msg})
      }
    }
    setRunning(null)
    toast(bulkSummary(action, outcomes, tBrowser), 8000)
    onClear()
  }
  const n = picked.length
  const reason = publishReason ?? (!canWrite ? t('You cannot change documents here') : undefined)
  const busy = !!running || !!bulk
  // Discard needs a draft over a published version (the footer offers it only then).
  const discardable = picked.some((d) => d._draft && d._hasPublished !== false)
  return (
    <div className="bulk-bar" role="region" aria-label={t('Bulk actions')}>
      <span className="bulk-count" role="status">
        {running
          ? running.action === 'publish'
            ? t('Publishing {at} of {n}…', {at: running.at, n})
            : t('Unpublishing {at} of {n}…', {at: running.at, n})
          : t('{n} selected', {n})}
      </span>
      <button type="button" className="btn-text" disabled={busy} onClick={onClear}>
        {t('Clear')}
      </button>
      <div className="bulk-actions">
        <button type="button" className="publish" disabled={busy || !!reason} title={reason} onClick={() => void run('publish')}>
          {t('Publish selected')}
        </button>
        <button type="button" className="btn" disabled={busy || !!reason} title={reason} onClick={() => setConfirming(true)}>
          {t('Unpublish selected')}
        </button>
        {/* A Viewer sees none of these (nor the ticks: Structure's `selectable`); a Contributor's Delete takes drafts only. */}
        {canWrite && (
          <>
            <button type="button" className="btn" disabled={busy} onClick={() => setBulk('duplicate')}>
              {t('Duplicate selected')}
            </button>
            <button type="button" className="btn" disabled={busy || !discardable} title={discardable ? undefined : t('None of them has changes to discard')} onClick={() => setBulk('discard')}>
              {t('Discard changes')}
            </button>
            <button type="button" className="btn danger-text" disabled={busy} onClick={() => setBulk('delete')}>
              {t('Delete selected')}
            </button>
          </>
        )}
      </div>
      {confirming && (
        <UnpublishDialog docs={picked.filter((d) => d._hasPublished !== false)} run={async () => void run('unpublish')} onClose={() => setConfirming(false)} />
      )}
      {bulk && <BulkDialog action={bulk} docs={picked} onClose={ended} />}
    </div>
  )
}
