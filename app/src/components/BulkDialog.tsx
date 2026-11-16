import {useEffect, useMemo, useRef, useState} from 'react'
import {useQueries, useQuery, useQueryClient} from '@tanstack/react-query'
import {backlinksQuery, ensureBacklinks, previewTitle, schemaOf, schemasQuery, type Doc} from '../lib/data'
import {bulkResultSummary, planBulk, retryIds, type BulkAction, type BulkRow, type Hold, type RowResult, type Step} from '../lib/bulk'
import {runBulkRow} from '../lib/bulk-run'
import {useCanWrite} from '../lib/session'
import {copyRank} from './OrderableRows'
import {DialogBox} from './FocusScopes'
import {UsedInList} from './DeleteDialog'
import {useScopedHref} from './PaneLink'
import {Close} from './icons'
import {useT} from '../lib/i18n'

// Bulk Delete, Duplicate and Discard changes (task-22ce73ad72423b85). One dialog, three
// phases: the confirm names the count and every ticked row the action leaves alone, and why
// (a delete: who still refers to it, as the single Delete's "used in"); the run goes one row
// at a time, each judged again just before (lib/bulk-run.ts), with its progress; the result
// says per row what happened, and a retry runs only what failed or was stopped.

const BACKLINKS_BATCH = 100
const rowOf = (d: Doc): BulkRow => ({id: d._publishedId, type: d._type, draft: !!d._draft, published: d._hasPublished !== false})

export function BulkDialog({action, docs, onClose}: {action: BulkAction; docs: Doc[]; onClose: (results: Map<string, RowResult> | null) => void}) {
  const t = useT()
  const qc = useQueryClient()
  const scoped = useScopedHref()
  const {data: schemas = []} = useQuery(schemasQuery)
  const {canWrite, canPublish, editReason, deletePublishedReason} = useCanWrite()
  const perms = {canWrite, canPublish}
  const [phase, setPhase] = useState<'confirm' | 'running' | 'done'>('confirm')
  const [results, setResults] = useState<Map<string, RowResult>>(() => new Map())
  // The rows as they were when the run began: a row deleted on the way keeps its title here.
  const [frozen, setFrozen] = useState<Doc[] | null>(null)
  // Where the run is: row `i` of `of` (this run's rows; a retry counts its own).
  const [at, setAt] = useState({i: 0, of: 0})
  const rows = frozen ?? docs
  const stop = useRef(false)
  const alive = useRef(true)
  useEffect(() => () => void (alive.current = false), [])
  // A copy's id, fixed per row: a retry after a lost answer finds that copy instead of making a second.
  const copyIds = useRef(new Map<string, string>())
  const copyId = (id: string) => copyIds.current.get(id) ?? (copyIds.current.set(id, crypto.randomUUID()), copyIds.current.get(id)!)

  // A delete's "used in", every row's in batches first (as the bulk Unpublish), kept live by
  // frames (lib/live.ts): a reference added while the confirm is open holds that row back.
  const ids = docs.map((d) => d._publishedId)
  const [primed, setPrimed] = useState(action !== 'delete')
  useEffect(() => {
    if (action !== 'delete') return
    let live = true
    void (async () => {
      for (let i = 0; i < ids.length; i += BACKLINKS_BATCH) if (!(await ensureBacklinks(qc, ids.slice(i, i + BACKLINKS_BATCH)).catch(() => false))) break
      if (live) setPrimed(true)
    })()
    return () => void (live = false)
  }, [ids.join(',')])
  // Only while the confirm is up: during the run each delete sends frames, and every frame
  // re-read every row's "used in" (the run checks each row itself, just before it goes).
  const lookups = useQueries({queries: action === 'delete' ? docs.map((d) => ({...backlinksQuery(d._publishedId), refetchOnMount: 'always' as const, retry: false, enabled: primed && phase === 'confirm'})) : []})
  const checking = action === 'delete' && (!primed || lookups.some((q) => q.isPending && q.fetchStatus !== 'idle'))
  const offline = lookups.some((q) => q.fetchStatus === 'paused')
  const lookupFailed = lookups.some((q) => q.isError && !q.isFetching)
  const refsOf = (id: string) => {
    const q = lookups[ids.indexOf(id)]
    return q && !q.isError && q.data ? q.data : undefined
  }
  const plan: Step[] = useMemo(() => planBulk(action, docs.map(rowOf), perms, refsOf), [action, docs, canWrite, canPublish, lookups.map((q) => q.dataUpdatedAt + ':' + q.errorUpdatedAt).join()])
  const going = plan.filter((s) => s.go)
  const staying = plan.filter((s): s is Extract<Step, {go: false}> => !s.go)

  const cancel = useRef<HTMLButtonElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  useEffect(() => cancel.current?.focus(), [])
  // The focus follows the footer: Stop while running (Cancel's place), Close after.
  useEffect(() => void (phase === 'running' ? cancel.current?.focus() : phase === 'done' && closeBtn.current?.focus()), [phase])

  const title = (d: Doc) => previewTitle(d, schemaOf(schemas, d._type), t)
  const n = docs.length
  const heading =
    action === 'delete' ? (n === 1 ? t('Delete 1 document?') : t('Delete {n} documents?', {n})) : action === 'duplicate' ? (n === 1 ? t('Duplicate 1 document?') : t('Duplicate {n} documents?', {n})) : n === 1 ? t('Discard changes in 1 document?') : t('Discard changes in {n} documents?', {n})
  const go = going.length
  const actionLabel = action === 'delete' ? (go === 1 ? t('Delete 1 document') : t('Delete {n} documents', {n: go})) : action === 'duplicate' ? (go === 1 ? t('Duplicate 1 document') : t('Duplicate {n} documents', {n: go})) : go === 1 ? t('Discard changes in 1 document') : t('Discard changes in {n} documents', {n: go})

  const set = (id: string, r: RowResult) => alive.current && setResults((m) => new Map(m).set(id, r))
  const run = async (runIds: string[], failedBefore: Set<string>) => {
    const byId = new Map(rows.map((d) => [d._publishedId, d]))
    if (!frozen) setFrozen(docs)
    stop.current = false
    setPhase('running')
    setResults((m) => {
      const next = new Map(m)
      for (const id of runIds) next.set(id, {state: 'waiting'})
      return next
    })
    for (const [i, id] of runIds.entries()) {
      // Stopped, or the dialog went away: the rest is not run, and says so.
      if (stop.current || !alive.current) {
        for (const rest of runIds.slice(i)) set(rest, {state: 'skipped', why: 'stopped'})
        break
      }
      const doc = byId.get(id)!
      setAt({i: i + 1, of: runIds.length})
      set(id, {state: 'running'})
      const r = await runBulkRow(qc, action, id, doc._type, {
        perms,
        translated: !!schemaOf(schemas, doc._type)?.translations,
        copyId: copyId(id),
        rank: (from) => copyRank(qc, from),
        retrying: failedBefore.has(id),
      }).catch((err: Error): RowResult => ({state: 'failed', reason: err.message}))
      set(id, r)
    }
    if (action === 'duplicate') void qc.invalidateQueries({queryKey: ['list']})
    if (alive.current) setPhase('done')
  }
  const start = () => {
    // Rows held back at the confirm show in the result too, with their reason.
    setResults(new Map(staying.map((s) => [s.row.id, {state: 'skipped', why: s.why, ...(s.refs && {refs: s.refs})} as RowResult])))
    void run(going.map((s) => s.row.id), new Set())
  }
  const retry = () => {
    const again = retryIds(results)
    void run(again, new Set(again.filter((id) => results.get(id)?.state === 'failed')))
  }
  const close = () => (phase === 'running' ? undefined : onClose(phase === 'done' ? results : null))

  const holdText = (why: Hold) =>
    ({
      referenced: t('Left alone: other documents refer to it'),
      unchecked: t('Left alone: could not check where it is used'),
      role: !canWrite ? (editReason ?? '') : (deletePublishedReason ?? ''),
      'no-changes': t('Left alone: no changes to discard'),
      'never-published': t('Left alone: never published, so discarding would delete it. Use Delete instead.'),
      gone: t('Left alone: it no longer exists'),
      stopped: t('Not run: stopped'),
    })[why]
  const doneText = action === 'delete' ? t('Deleted') : action === 'duplicate' ? t('Duplicated') : t('Changes discarded')
  const runningText = action === 'delete' ? t('Deleting…') : action === 'duplicate' ? t('Duplicating…') : t('Discarding…')
  const vars = {at: at.i, n: at.of}
  const progress = action === 'delete' ? t('Deleting {at} of {n}…', vars) : action === 'duplicate' ? t('Duplicating {at} of {n}…', vars) : t('Discarding {at} of {n}…', vars)
  const summary = bulkResultSummary(action, [...results.values()], t)
  const again = phase === 'done' ? retryIds(results) : []
  const deleted = action === 'delete' ? rows.filter((d) => results.get(d._publishedId)?.state === 'done') : []

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <DialogBox className="dialog delete-dialog bulk-dialog" aria-modal="true" aria-labelledby="bulk-title" onClose={close}>
        <header>
          <h2 id="bulk-title">{heading}</h2>
          <button type="button" className="icon-btn" aria-label={t('Close')} disabled={phase === 'running'} onClick={close}>
            <Close />
          </button>
        </header>
        <div className="dialog-body">
          {phase === 'confirm' && (
            <>
              <p>
                {action === 'delete'
                  ? t('Each one goes with its draft and its published version. A deleted document can be restored from its history.')
                  : action === 'duplicate'
                    ? t('Each copy is a new draft with the same content.')
                    : t('Each one goes back to its published version. A discarded draft can still be recovered from history.')}
              </p>
              {checking && <p className="muted" role="status">{offline ? t("You're offline. Reconnect to check which documents refer to them.") : t('Looking for documents that refer to them…')}</p>}
              {lookupFailed && (
                <div role="alert">
                  <p>{t('Could not check where some of them are used. Those are left alone unless the check succeeds.')}</p>
                  <button type="button" className="btn" onClick={() => (cancel.current?.focus(), lookups.forEach((q) => q.isError && void q.refetch()))}>
                    {t('Retry')}
                  </button>
                </div>
              )}
              {!checking && staying.length > 0 && (
                <section className="bulk-held" aria-label={t('Left alone')}>
                  <p className="warning" role="status">
                    {staying.length === 1 ? t('1 of the {n} selected will be left alone:', {n}) : t('{held} of the {n} selected will be left alone:', {held: staying.length, n})}
                  </p>
                  <ul className="bulk-results">
                    {staying.map((s) => {
                      const d = docs.find((x) => x._publishedId === s.row.id)!
                      return (
                        <li key={s.row.id} data-state="skipped">
                          <span className="bulk-row-title">{title(d)}</span>
                          <span className="bulk-row-state">{holdText(s.why)}</span>
                          {s.refs && <UsedInList refs={s.refs} field />}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )}
            </>
          )}
          {phase !== 'confirm' && (
            <>
              {phase === 'running' && (
                <div className="bulk-progress">
                  <p role="status">{progress}</p>
                  <progress max={at.of || 1} value={Math.max(0, at.i - 1)} aria-label={t('Progress')} />
                </div>
              )}
              {phase === 'done' && <p role="status">{[summary.title + '.', summary.description].filter(Boolean).join(' ')}</p>}
              <ul className="bulk-results" aria-label={t('Results')}>
                {rows.map((d) => {
                  const r = results.get(d._publishedId)
                  if (!r) return null
                  return (
                    <li key={d._publishedId} data-state={r.state}>
                      <span className="bulk-row-title">{title(d)}</span>
                      <span className="bulk-row-state">
                        {r.state === 'waiting' ? t('Waiting') : r.state === 'running' ? runningText : r.state === 'done' ? doneText : r.state === 'failed' ? t('Failed: {error}', {error: t(r.reason)}) : holdText(r.why)}
                        {r.state === 'done' && r.copy && (
                          <>
                            {' '}
                            <a href={scoped(`/structure/${d._type};${encodeURIComponent(r.copy)}`)} target="_blank" rel="noreferrer">
                              {t('Open the copy')}
                            </a>
                          </>
                        )}
                      </span>
                      {r.state === 'skipped' && r.refs && <UsedInList refs={r.refs} field />}
                    </li>
                  )
                })}
              </ul>
              {phase === 'done' && deleted.length > 0 && <p className="muted">{t('To undo a delete, open the document and choose Restore most recent revision.')}</p>}
              {phase === 'done' && deleted.length > 0 && (
                <ul className="bulk-restore">
                  {deleted.map((d) => (
                    <li key={d._publishedId}>
                      <a href={scoped(`/structure/${d._type};${encodeURIComponent(d._publishedId)}`)} target="_blank" rel="noreferrer">
                        {t('Restore “{title}”', {title: title(d)})}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        <footer>
          {phase === 'confirm' && (
            <>
              <button type="button" className="btn" ref={cancel} onClick={close}>
                {t('Cancel')}
              </button>
              <button type="button" className={action === 'duplicate' ? 'btn btn-primary' : 'btn danger'} disabled={checking || go === 0} onClick={start}>
                {go === 0 ? t('Nothing to do') : actionLabel}
              </button>
            </>
          )}
          {phase === 'running' && (
            <button type="button" className="btn" ref={cancel} disabled={at.i >= at.of} onClick={() => (stop.current = true)}>
              {t('Stop after this one')}
            </button>
          )}
          {phase === 'done' && (
            <>
              {again.length > 0 && (
                <button type="button" className="btn" onClick={retry}>
                  {again.length === 1 ? t('Retry 1') : t('Retry {n}', {n: again.length})}
                </button>
              )}
              <button type="button" className="btn btn-primary" ref={closeBtn} onClick={close}>
                {t('Close')}
              </button>
            </>
          )}
        </footer>
      </DialogBox>
    </div>
  )
}
