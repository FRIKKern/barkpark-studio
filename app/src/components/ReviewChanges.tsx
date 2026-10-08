import {useState} from 'react'
import {DialogBox} from './FocusScopes'
import {useQueries, useQuery} from '@tanstack/react-query'
import {asText, authorsByField, changedFields, sinceLastPublish, textDiff, type FieldChange} from '../lib/changes'
import {historyQuery, revisionQuery, type Revision} from '../lib/history'
import type {Doc, Schema} from '../lib/data'
import {rangeDate} from './HistoryPanel'
import {Undo} from './icons'
import {userColorVars} from '../lib/user-colors'
import {assetUrl, type ImageValue} from '../lib/image'

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
          <dd>{isPending ? '…' : drafts.at(-1) ? `Draft created: ${rangeDate(drafts.at(-1)!.timestamp)}` : published ? 'Published' : 'Not published'}</dd>
        </div>
        <div>
          <dt>To</dt>
          <dd>{isPending ? '…' : drafts[0] ? `Edited: ${rangeDate(drafts[0].timestamp)}` : 'Current draft'}</dd>
        </div>
      </dl>
      {changes.length === 0 ? (
        <div className="review-empty">
          <h3>There are no changes</h3>
          <p className="muted">Edit the document or select an older version in the timeline to see a list of changes appear in this panel.</p>
        </div>
      ) : (
        <>
          <ul className="review-list">
            {changes.map((c) => (
              <li key={c.field.name} data-field={c.field.name}>
                <div className="review-head">
                  <span className="review-field">{c.field.title ?? c.field.name}</span>
                </div>
                <div className="review-body">
                  <ChangeView change={c} author={c.authors[0]} />
                  <Revert label={`Revert changes to ${c.field.title ?? c.field.name}`} onConfirm={() => onRevert([c])}>
                    <Undo />
                  </Revert>
                </div>
              </li>
            ))}
          </ul>
          {/* Sanity offers Revert all only when there is more than one change. */}
          {changes.length > 1 && (
            <Revert label="Revert all" className="revert-all" count={changes.length} onConfirm={() => onRevert(changes)}>
              <Undo /> Revert all
            </Revert>
          )}
        </>
      )}
    </div>
  )
}

/** An image value's asset id, if `v` is one. */
const imageRef = (v: unknown) => (v as ImageValue | undefined)?.asset?._ref

/** One field's change; text is tinted with its author's colour, as Sanity's. */
function ChangeView({change, author}: {change: FieldChange; author?: string}) {
  // An image: before → after thumbnails, as Sanity's image diff.
  if (imageRef(change.before) || imageRef(change.after)) {
    const thumb = (v: unknown, what: string) =>
      imageRef(v) ? <img src={`${assetUrl(imageRef(v)!)}?size=thumb`} alt={what} /> : <span className="review-img-none">{what === 'Before' ? 'No image' : 'Removed'}</span>
    return (
      <p className="review-diff review-img">
        {thumb(change.before, 'Before')}
        <span aria-hidden="true">→</span>
        {thumb(change.after, 'After')}
      </p>
    )
  }
  const before = asText(change.before)
  const after = asText(change.after)
  if (before === undefined || after === undefined)
    return <p className="review-diff muted">{change.before === undefined ? 'Added' : change.after === undefined ? 'Removed' : 'Changed'}</p>
  const by = (what: string) => (author ? `${what} by ${author}` : what)
  return (
    <p className="review-diff" style={userColorVars(author ?? 'unknown')}>
      {textDiff(before, after).map((s, i) =>
        // Who did it, in the segment's tooltip (Sanity: "Added" / "Removed" with the author).
        s.kind === 'removed' ? <del key={i} title={by('Removed')}>{s.text}</del> : s.kind === 'added' ? <ins key={i} title={by('Added')}>{s.text}</ins> : <span key={i}>{s.text}</span>,
      )}
    </p>
  )
}

/** A revert button that asks first, with Sanity's words. */
function Revert({label, className = 'revert-one', count, onConfirm, children}: {label: string; className?: string; count?: number; onConfirm: () => void; children: React.ReactNode}) {
  // Sanity's per-field revert is an icon with a "Revert change" tooltip; Revert all keeps its words
  // and asks about all `count` changes.
  const title = className === 'revert-one' ? 'Revert change' : undefined
  const question = count ? `Are you sure you want to revert all ${count} changes?` : 'Are you sure you want to revert the change?'
  const [asking, setAsking] = useState(false)
  return (
    <span className="menu-wrap">
      <button type="button" className={className} aria-label={label} title={title} aria-expanded={asking} onClick={() => setAsking((a) => !a)}>
        {children}
      </button>
      {asking && (
        <DialogBox className="popover confirm" aria-label={question} onClose={() => setAsking(false)}>
          <p>{question}</p>
          <div className="confirm-actions">
            <button type="button" className="btn" autoFocus onClick={() => setAsking(false)}>
              Cancel
            </button>
            <button type="button" className="btn danger" onClick={() => (setAsking(false), onConfirm())}>
              {count ? 'Revert all' : 'Revert change'}
            </button>
          </div>
        </DialogBox>
      )}
    </span>
  )
}
