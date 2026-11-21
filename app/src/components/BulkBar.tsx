import {useState} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {docTitle, schemaOf, schemasQuery, type Doc} from '../lib/data'
import {offers, type FixedAction} from '../lib/fixed-documents'
import {bulkResultSummary, bulkSummary, type BulkAction, type RowResult} from '../lib/bulk'
import {runBulk, type Judge} from '../lib/bulk-publish'
import {rulesFor} from '../lib/use-custom-rules'
import {fileInfoQuery} from '../lib/file-info'
import {useCurrentUser} from '../lib/person-source'
import studio from '../studio.config'
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
  const user = useCurrentUser()
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
    // Slugs in use, asked once for all of them (publish asks per doc otherwise). Can't tell: none.
    setRunning({action, at: 1})
    const schemas = qc.getQueryData(schemasQuery.queryKey)
    const latest = picked.filter((d) => d._draft).map((d) => qc.getQueryData<Doc>(['doc', d._publishedId]) ?? d)
    const taken = action === 'publish' ? await slugsTakenAmong(qc, latest, (type) => schemas?.find((x) => x.name === type)).catch(() => new Map<string, string[]>()) : new Map<string, string[]>()
    // A publish asks what the document's own Publish asks, for this person (lib/publish-check.ts).
    const judge: Judge = {conditions: studio.form?.conditions, schemaFor: (type) => schemaOf(schemas ?? [], type), rulesFor, nameOf: (d, s) => (s ? docTitle(d, s, t) : d._publishedId), t, widthOf: (ref) => qc.getQueryData(fileInfoQuery(ref).queryKey)}
    const outcomes = await runBulk(qc, action, picked, user, {taken, judge, at: (i) => setRunning({action, at: i}), t})
    setRunning(null)
    toast(bulkSummary(action, outcomes, tBrowser), 8000)
    onClear()
  }
  const n = picked.length
  const reason = publishReason ?? (!canWrite ? t('You cannot change documents here') : undefined)
  const busy = !!running || !!bulk
  // Discard needs a draft over a published version (the footer offers it only then).
  const discardable = picked.some((d) => d._draft && d._hasPublished !== false)
  // A fixed set of documents (lib/fixed-documents.ts): no copies, and no delete of a listed one.
  const {data: schemas = []} = useQuery(schemasQuery)
  const offered = (action: FixedAction) => picked.every((d) => offers(schemaOf(schemas, d._type)?.fixedDocuments, action, d._publishedId))
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
            {offered('duplicate') && (
              <button type="button" className="btn" disabled={busy} onClick={() => setBulk('duplicate')}>
                {t('Duplicate selected')}
              </button>
            )}
            <button type="button" className="btn" disabled={busy || !discardable} title={discardable ? undefined : t('None of them has changes to discard')} onClick={() => setBulk('discard')}>
              {t('Discard changes')}
            </button>
            {offered('delete') && (
              <button type="button" className="btn danger-text" disabled={busy} onClick={() => setBulk('delete')}>
                {t('Delete selected')}
              </button>
            )}
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
