import {useState} from 'react'
import {DialogBox} from './FocusScopes'
import {useQueries, useQuery} from '@tanstack/react-query'
import {asText, authorsByField, changedFields, sinceLastPublish, textDiff, type FieldChange} from '../lib/changes'
import {historyQuery, revisionQuery, type Revision} from '../lib/history'
import type {Doc, Schema} from '../lib/data'
import {revisionDate} from './HistoryPanel'
import {Undo} from './icons'

// Sanity's "Review changes" (J15): every field the draft changed since it was last
// published, with who changed it, the change itself (text as a word diff), a
// revert per field and "Revert all". Snapshots are fetched for the draft's own
// revisions only (at most SNAPSHOTS), to credit authors.
const SNAPSHOTS = 12

export function ReviewChanges({schema, draft, published, onRevert}: {schema: Schema; draft: Doc; published: Doc | null | undefined; onRevert: (changes: FieldChange[]) => void}) {
  const {data: revisions = [], isPending} = useQuery(historyQuery(draft._type, draft._publishedId))
  const {draft: drafts, publish} = sinceLastPublish(revisions)
  const wanted = [...drafts.slice(0, SNAPSHOTS), ...(publish ? [publish] : [])]
  const snaps = useQueries({queries: wanted.map((r) => revisionQuery(r.id))})
  const ready = snaps.every((s) => s.data)
  const authors = ready ? authorsByField(wanted.map((r, i) => [r, snaps[i]!.data!.content] as [Revision, Record<string, unknown>])) : new Map<string, string[]>()
  const changes = changedFields(schema, published, draft).map((c) => ({...c, authors: authors.get(c.field.name) ?? []}))
  return (
    <div className="review">
      <dl className="review-range">
        <div>
          <dt>From</dt>
          <dd>{isPending ? '…' : drafts.at(-1) ? `Draft created: ${revisionDate(drafts.at(-1)!.timestamp)}` : published ? 'Published' : 'Not published'}</dd>
        </div>
        <div>
          <dt>To</dt>
          <dd>{isPending ? '…' : drafts[0] ? `Edited: ${revisionDate(drafts[0].timestamp)}` : 'Current draft'}</dd>
        </div>
      </dl>
      {changes.length === 0 ? (
        <div className="review-empty">
          <h3>There are no changes</h3>
          <p className="muted">Edit the document to see a list of changes appear in this panel.</p>
        </div>
      ) : (
        <>
          <ul className="review-list">
            {changes.map((c) => (
              <li key={c.field.name} data-field={c.field.name}>
                <div className="review-head">
                  <span className="review-field">{c.field.title ?? c.field.name}</span>
                  <span className="review-authors" aria-label={`Changed by ${c.authors.join(', ') || 'unknown'}`}>
                    {c.authors.map((a) => (
                      <span key={a} className="avatar small" title={a}>
                        {a === 'API token' ? '·' : a[0]?.toUpperCase()}
                      </span>
                    ))}
                  </span>
                </div>
                <div className="review-body">
                  <ChangeView change={c} />
                  <Revert label={`Revert changes to ${c.field.title ?? c.field.name}`} onConfirm={() => onRevert([c])}>
                    <Undo /> Revert change
                  </Revert>
                </div>
              </li>
            ))}
          </ul>
          <Revert label="Revert all" className="revert-all" onConfirm={() => onRevert(changes)}>
            <Undo /> Revert all
          </Revert>
        </>
      )}
    </div>
  )
}

function ChangeView({change}: {change: FieldChange}) {
  const before = asText(change.before)
  const after = asText(change.after)
  if (before === undefined || after === undefined)
    return <p className="review-diff muted">{change.before === undefined ? 'Added' : change.after === undefined ? 'Removed' : 'Changed'}</p>
  return (
    <p className="review-diff">
      {textDiff(before, after).map((s, i) =>
        s.kind === 'removed' ? <del key={i}>{s.text}</del> : s.kind === 'added' ? <ins key={i}>{s.text}</ins> : <span key={i}>{s.text}</span>,
      )}
    </p>
  )
}

/** A revert button that asks first, with Sanity's words. */
function Revert({label, className = 'revert-one', onConfirm, children}: {label: string; className?: string; onConfirm: () => void; children: React.ReactNode}) {
  const [asking, setAsking] = useState(false)
  return (
    <span className="menu-wrap">
      <button type="button" className={className} aria-label={label} aria-expanded={asking} onClick={() => setAsking((a) => !a)}>
        {children}
      </button>
      {asking && (
        <DialogBox className="popover confirm" aria-label="Revert the change?" onClose={() => setAsking(false)}>
          <p>Are you sure you want to revert the change?</p>
          <div className="confirm-actions">
            <button type="button" className="btn" autoFocus onClick={() => setAsking(false)}>
              Cancel
            </button>
            <button type="button" className="btn danger" onClick={() => (setAsking(false), onConfirm())}>
              Revert change
            </button>
          </div>
        </DialogBox>
      )}
    </span>
  )
}
