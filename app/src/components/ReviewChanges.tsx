import {useState, type ReactNode} from 'react'
import {DialogBox} from './FocusScopes'
import {useQueries, useQuery} from '@tanstack/react-query'
import {asText, authorsByField, changedFields, sinceLastPublish, textDiff, type FieldChange} from '../lib/changes'
import {historyQuery, revisionQuery, type HistoryEntry, type Revision} from '../lib/history'
import {flatEntries, rangeOptions, reviewRange, timeline} from '../lib/timeline'
import {docDiff, type DocBlock, type Piece} from '../lib/doc-diff'
import type {Doc, Schema} from '../lib/data'
import {rangeDate, Row} from './HistoryPanel'
import {ChevronDown, Undo} from './icons'
import {userColorVars} from '../lib/user-colors'
import {assetUrl, type ImageValue} from '../lib/image'
import {useLocale, useT, type T} from '../lib/i18n'

// Sanity's "Review changes" (J15): every field the draft changed since it was last
// published, with who changed it, the change itself (text as a word diff), a
// revert per field and "Revert all". Snapshots are fetched for the draft's own
// revisions only (at most SNAPSHOTS), to credit authors.
const SNAPSHOTS = 12

export function ReviewChanges({schema, draft, published, onRevert}: {schema: Schema; draft: Doc; published: Doc | null | undefined; onRevert: (changes: FieldChange[]) => void}) {
  const t = useT()
  const locale = useLocale()
  const {data: revisions = [], isPending} = useQuery(historyQuery(draft._type, draft._publishedId))
  const {draft: drafts, publish} = sinceLastPublish(revisions)
  // Sanity's From / To: picked points of the timeline; unpicked, the draft since it was last published.
  const entries = flatEntries(timeline(revisions))
  const [picked, setPicked] = useState<{from?: string; to?: string}>({})
  const fromEntry = entries.find((e) => e.revision.id === picked.from) ?? (drafts.length ? entries.find((e) => e.revision.id === drafts.at(-1)!.id) : undefined)
  const toEntry = entries.find((e) => e.revision.id === picked.to) ?? null
  const custom = !!(picked.from || picked.to) && !!fromEntry
  const range = custom ? reviewRange(revisions, fromEntry!, toEntry) : undefined
  const wanted = custom
    ? [...range!.between.slice(0, SNAPSHOTS), ...(range!.base ? [range!.base] : [])]
    : [...drafts.slice(0, SNAPSHOTS), ...(publish ? [publish] : [])]
  const snaps = useQueries({queries: wanted.map((r) => revisionQuery(r.id))})
  const ready = snaps.every((s) => s.data)
  const content = (r?: Revision) => (r ? snaps[wanted.indexOf(r)]?.data?.content : undefined)
  const authors = ready ? authorsByField(wanted.map((r, i) => [r, snaps[i]!.data!.content] as [Revision, Record<string, unknown>])) : new Map<string, string[]>()
  const before = custom ? (range!.base ? content(range!.base) : {}) : published
  const after = custom ? (range!.target ? content(range!.target) : draft) : draft
  const changes = before === undefined || after === undefined ? [] : changedFields(schema, before, after).map((c) => ({...c, authors: authors.get(c.field.name) ?? []}))
  const options = fromEntry ? rangeOptions(revisions, entries, fromEntry, toEntry) : {from: [], to: []}
  const fromText = fromEntry ? `${t(fromEntry.label)}: ${rangeDate(fromEntry.revision.timestamp, locale)}` : published ? t('Published') : t('Not published')
  const toText = toEntry ? `${t(toEntry.label)}: ${rangeDate(toEntry.revision.timestamp, locale)}` : drafts[0] ? `${t('Edited')}: ${rangeDate(drafts[0].timestamp, locale)}` : t('Current draft')
  return (
    <div className="review">
      <dl className="review-range">
        <div>
          <dt>{t('From')}</dt>
          <dd>{isPending ? '…' : <RangePicker label={t('From')} text={fromText} options={options.from} selected={fromEntry} onPick={(e) => setPicked((p) => ({...p, from: e.revision.id}))} />}</dd>
        </div>
        <div>
          <dt>{t('To')}</dt>
          <dd>{isPending ? '…' : <RangePicker label={t('To')} text={toText} options={options.to} selected={toEntry ?? entries[0]} onPick={(e) => setPicked((p) => ({...p, to: e === entries[0] ? undefined : e.revision.id}))} />}</dd>
        </div>
      </dl>
      {changes.length === 0 ? (
        <div className="review-empty">
          <h3>{t('There are no changes')}</h3>
          <p className="muted">{t('Edit the document or select an older version in the timeline to see a list of changes appear in this panel.')}</p>
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
                  <Revert label={t('Revert changes to {field}', {field: c.field.title ?? c.field.name})} onConfirm={() => onRevert([c])}>
                    <Undo />
                  </Revert>
                </div>
              </li>
            ))}
          </ul>
          {/* Sanity offers Revert all only when there is more than one change. */}
          {changes.length > 1 && (
            <Revert label={t('Revert all')} className="revert-all" count={changes.length} onConfirm={() => onRevert(changes)}>
              <Undo /> {t('Revert all')}
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
  const t = useT()
  // An image: before → after thumbnails, as Sanity's image diff.
  if (imageRef(change.before) || imageRef(change.after)) {
    const thumb = (v: unknown, what: 'Before' | 'After') =>
      imageRef(v) ? <img src={`${assetUrl(imageRef(v)!)}?size=thumb`} alt={t(what)} /> : <span className="review-img-none">{what === 'Before' ? t('No image') : t('Removed')}</span>
    return (
      <p className="review-diff review-img">
        {thumb(change.before, 'Before')}
        <span aria-hidden="true">→</span>
        {thumb(change.after, 'After')}
      </p>
    )
  }
  // Rich text: only the changed blocks, in their own style, marks kept (Sanity's).
  const blocksOf = (v: unknown) => (v as {blocks?: DocBlock[]} | undefined)?.blocks
  if (Array.isArray(blocksOf(change.before)) || Array.isArray(blocksOf(change.after)))
    return <BlocksDiff before={blocksOf(change.before)} after={blocksOf(change.after)} author={author} t={t} />
  const before = asText(change.before)
  const after = asText(change.after)
  if (before === undefined || after === undefined)
    return <p className="review-diff muted">{change.before === undefined ? t('Added') : change.after === undefined ? t('Removed') : t('Changed')}</p>
  const by = (what: string) => (author ? t(`${what} by {author}`, {author}) : t(what))
  return (
    <p className="review-diff" style={userColorVars(author ?? 'unknown')}>
      {textDiff(before, after).map((s, i) =>
        // Who did it, in the segment's tooltip (Sanity: "Added" / "Removed" with the author).
        s.kind === 'removed' ? <del key={i} title={by('Removed')}>{s.text}</del> : s.kind === 'added' ? <ins key={i} title={by('Added')}>{s.text}</ins> : <span key={i}>{s.text}</span>,
      )}
    </p>
  )
}

const MARK_TAGS: Record<string, string> = {strong: 'strong', em: 'em', code: 'code', underline: 'u', strikethrough: 's', highlight: 'mark', sub: 'sub', sup: 'sup'}

/** A rich-text change: each changed block drawn as itself, the diff inside it. */
function BlocksDiff({before, after, author, t}: {before?: DocBlock[]; after?: DocBlock[]; author?: string; t: T}) {
  const by = (what: string) => (author ? t(`${what} by {author}`, {author}) : t(what))
  const piece = (x: Piece, i: number) => {
    let node: ReactNode = x.text
    for (const m of [...x.marks].reverse()) {
      const Tag = (MARK_TAGS[m] ?? 'span') as 'span'
      node = <Tag>{node}</Tag>
    }
    if (x.href) node = <a href={x.href} target="_blank" rel="noopener noreferrer">{node}</a>
    return x.change === 'removed' ? <del key={i} title={by('Removed')}>{node}</del> : x.change === 'added' ? <ins key={i} title={by('Added')}>{node}</ins> : <span key={i}>{node}</span>
  }
  const changes = docDiff(before, after)
  return (
    <div className="review-diff review-blocks" style={userColorVars(author ?? 'unknown')}>
      {changes.map(({kind, block: b, pieces, items}) => {
        const body = pieces.map(piece)
        const k = `${kind}-${b.id}`
        switch (b.type) {
          case 'heading': {
            const H = `h${Math.min(6, Math.max(1, b.level ?? 2))}` as 'h2'
            return <H key={k} data-change={kind}>{body}</H>
          }
          case 'list': {
            const L = b.ordered ? 'ol' : 'ul'
            return <L key={k} data-change={kind}>{(items ?? []).map((it, i) => (it.some((x) => x.change !== 'same') ? <li key={i}>{it.map(piece)}</li> : null))}</L>
          }
          case 'pullquote':
          case 'blockquote':
            return <blockquote key={k} data-change={kind}>{body}</blockquote>
          case 'callout':
            return <div key={k} className="callout" data-tone={b.tone} data-change={kind}>{body}</div>
          default:
            return <p key={k} data-change={kind}>{body}</p>
        }
      })}
    </div>
  )
}

/** Sanity's From / To picker: the range end as text; open, the timeline to pick another from. */
function RangePicker({label, text, options, selected, onPick}: {label: string; text: string; options: HistoryEntry[]; selected?: HistoryEntry; onPick: (e: HistoryEntry) => void}) {
  const [open, setOpen] = useState(false)
  return (
    <span className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <button type="button" className="review-pick" aria-label={`${label}: ${text}`} aria-expanded={open} disabled={!options.length} onClick={() => setOpen((o) => !o)}>
        <span>{text}</span>
        <ChevronDown />
      </button>
      {open && (
        <DialogBox className="popover review-pick-menu" onClose={() => setOpen(false)} aria-label={label}>
          <ul className="history-list" aria-label={label}>
            {options.map((e) => (
              <Row key={e.revision.id} e={e} selected={e === selected} onPick={() => (setOpen(false), onPick(e))} />
            ))}
          </ul>
        </DialogBox>
      )}
    </span>
  )
}

/** A revert button that asks first, with Sanity's words. */
function Revert({label, className = 'revert-one', count, onConfirm, children}: {label: string; className?: string; count?: number; onConfirm: () => void; children: React.ReactNode}) {
  const t = useT()
  // Sanity's per-field revert is an icon with a "Revert change" tooltip; Revert all keeps its words
  // and asks about all `count` changes.
  const title = className === 'revert-one' ? t('Revert change') : undefined
  const question = count ? t('Are you sure you want to revert all {count} changes?', {count}) : t('Are you sure you want to revert the change?')
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
              {t('Cancel')}
            </button>
            <button type="button" className="btn danger" onClick={() => (setAsking(false), onConfirm())}>
              {count ? t('Revert all') : t('Revert change')}
            </button>
          </div>
        </DialogBox>
      )}
    </span>
  )
}
