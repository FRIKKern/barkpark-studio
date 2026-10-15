import {Fragment, useEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {DialogBox} from './FocusScopes'
import {useInfiniteQuery, useQueries, useQuery} from '@tanstack/react-query'
import {asText, authorsByField, changedFields, sinceLastPublish, textDiff, type FieldChange} from '../lib/changes'
import {historyPagesQuery, revisionQuery, type HistoryEntry, type Revision} from '../lib/history'
import {flatEntries, rangeOptions, reviewRange, timeline} from '../lib/timeline'
import {docDiff, type AttrChange, type DocBlock, type Piece} from '../lib/doc-diff'
import {docQuery, previewTitle, refId, refTypesOf, schemaOf, schemasQuery, type Doc, type Field, type Schema} from '../lib/data'
import {arrayDiff} from '../lib/array-diff'
import {useItemPreview} from './ObjectArrayInput'
import {rangeDate, Row} from './HistoryPanel'
import {ChevronDown, Undo} from './icons'
import {userColorVars} from '../lib/user-colors'
import {assetUrl, imageRef, type ImageValue} from '../lib/image'
import {useLocale, useT, type T} from '../lib/i18n'

// Sanity's "Review changes" (J15): every field the draft changed since it was last
// published, with who changed it, the change itself (text as a word diff), a
// revert per field and "Revert all". Snapshots are fetched for the draft's own
// revisions only (at most SNAPSHOTS), to credit authors.
const SNAPSHOTS = 12

export function ReviewChanges({schema, draft, published, onRevert}: {schema: Schema; draft: Doc; published: Doc | null | undefined; onRevert: (changes: FieldChange[]) => void}) {
  const t = useT()
  const locale = useLocale()
  // The whole timeline, a page at a time: the From picker reaches past the newest 100 (Sanity's loads as it scrolls).
  const pages = useInfiniteQuery(historyPagesQuery(draft._type, draft._publishedId))
  const {isPending, isFetching} = pages
  const revisions = useMemo(() => pages.data?.pages.flatMap((p) => p.revisions) ?? [], [pages.data])
  const more = pages.hasNextPage ? {loading: pages.isFetchingNextPage, load: () => void pages.fetchNextPage()} : undefined
  const {draft: drafts, publish} = sinceLastPublish(revisions)
  // A cached history from before this draft's edits lists none of them: until it is
  // fetched again the range is unknown ("…"), never the last publish's (J15).
  const catchingUp = draft._draft && !drafts.length && isFetching
  // Sanity's From / To: picked points of the timeline; unpicked, the draft since it was last published.
  const entries = flatEntries(timeline(revisions))
  const [picked, setPicked] = useState<{from?: string; to?: string}>({})
  // The timeline entry holding a revision: a run of edits is one entry, headed by its newest.
  const entryOf = (id: string) => {
    const i = revisions.findIndex((r) => r.id === id)
    return entries.find((e) => {
      const at = revisions.indexOf(e.revision)
      return at <= i && i <= at + e.count - 1
    })
  }
  const fromEntry = entries.find((e) => e.revision.id === picked.from) ?? (drafts.length ? entryOf(drafts.at(-1)!.id) : undefined)
  const toEntry = entries.find((e) => e.revision.id === picked.to) ?? null
  const custom = !!(picked.from || picked.to) && !!fromEntry
  const range = custom ? reviewRange(revisions, fromEntry!, toEntry) : undefined
  // Nothing unpublished (just published): Sanity shows what the last publish changed,
  // from the publish before it to that one, not an empty panel.
  const publishes = revisions.filter((r) => r.action === 'publish')
  const lastPublish = !custom && !draft._draft && !drafts.length && publishes.length > 1 ? {from: publishes[1]!, to: publishes[0]!} : undefined
  const sinceFrom = lastPublish ? revisions.slice(revisions.indexOf(lastPublish.to), revisions.indexOf(lastPublish.from)) : []
  const wanted = custom
    ? [...range!.between.slice(0, SNAPSHOTS), ...(range!.base ? [range!.base] : [])]
    : lastPublish
      ? [...sinceFrom.slice(0, SNAPSHOTS), lastPublish.from]
      : [...drafts.slice(0, SNAPSHOTS), ...(publish ? [publish] : [])]
  const snaps = useQueries({queries: wanted.map((r) => revisionQuery(r.id))})
  const ready = snaps.every((s) => s.data)
  const content = (r?: Revision) => (r ? snaps[wanted.indexOf(r)]?.data?.content : undefined)
  const authors = ready ? authorsByField(wanted.map((r, i) => [r, snaps[i]!.data!.content] as [Revision, Record<string, unknown>])) : new Map<string, string[]>()
  const before = custom ? (range!.base ? content(range!.base) : {}) : lastPublish ? content(lastPublish.from) : published
  const after = custom ? (range!.target ? content(range!.target) : draft) : lastPublish ? content(lastPublish.to) : draft
  // Either side still loading: say so, never "There are no changes" (J15: Sanity opens onto the diffs).
  const loading = before === undefined || after === undefined
  const changes = loading ? [] : changedFields(schema, before, after).map((c) => ({...c, authors: authors.get(c.field.name) ?? []}))
  const options = fromEntry ? rangeOptions(revisions, entries, fromEntry, toEntry) : {from: [], to: []}
  // Sanity names the start of the default range by the publish it starts from ("Published: …").
  const published_ = (r: Revision) => `${t('Published')}: ${rangeDate(r.timestamp, locale)}`
  const fromText = custom && fromEntry ? `${t(fromEntry.label)}: ${rangeDate(fromEntry.revision.timestamp, locale)}` : lastPublish ? published_(lastPublish.from) : publish ? published_(publish) : fromEntry ? `${t(fromEntry.label)}: ${rangeDate(fromEntry.revision.timestamp, locale)}` : published ? t('Published') : t('Not published')
  const toText = toEntry ? `${t(toEntry.label)}: ${rangeDate(toEntry.revision.timestamp, locale)}` : lastPublish ? published_(lastPublish.to) : drafts[0] ? `${t('Edited')}: ${rangeDate(drafts[0].timestamp, locale)}` : t('Current draft')
  return (
    <div className="review">
      <dl className="review-range">
        <div>
          <dt>{t('From')}</dt>
          <dd>{isPending || catchingUp ? '…' : <RangePicker label={t('From')} text={fromText} options={options.from} selected={fromEntry} more={more} onPick={(e) => setPicked((p) => ({...p, from: e.revision.id}))} />}</dd>
        </div>
        <div>
          <dt>{t('To')}</dt>
          <dd>{isPending || catchingUp ? '…' : <RangePicker label={t('To')} text={toText} options={options.to} selected={toEntry ?? entries[0]} onPick={(e) => setPicked((p) => ({...p, to: e === entries[0] ? undefined : e.revision.id}))} />}</dd>
        </div>
      </dl>
      {loading ? (
        <p className="review-loading muted" role="status">{t('Loading…')}</p>
      ) : changes.length === 0 ? (
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
const imageRefOf = (v: unknown) => imageRef(v)

/** One field's change; text is tinted with its author's colour, as Sanity's. */
function ChangeView({change, author}: {change: FieldChange; author?: string}) {
  const t = useT()
  const by = (what: string) => (author ? t(`${what} by {author}`, {author}) : t(what))
  // An image: before → after thumbnails, as Sanity's image diff.
  if (imageRefOf(change.before) || imageRefOf(change.after)) {
    const thumb = (v: unknown, what: 'Before' | 'After') =>
      imageRefOf(v) ? <img src={`${assetUrl(imageRefOf(v)!)}?size=thumb`} alt={t(what)} /> : <span className="review-img-none">{what === 'Before' ? t('No image') : t('Removed')}</span>
    // Its other subfields (alt text, hotspot, crop), as Sanity's image diff lists them.
    const was = (change.before ?? {}) as Record<string, unknown>
    const now = (change.after ?? {}) as Record<string, unknown>
    const subs = [...new Set([...Object.keys(was), ...Object.keys(now)])]
      .filter((k) => !['asset', '_type', '_key', 'assetId', 'url'].includes(k) && JSON.stringify(was[k]) !== JSON.stringify(now[k]))
      .sort()
      .map((name): AttrChange => ({name, before: was[name], after: now[name]}))
    return (
      <div className="review-diff review-img-change" style={userColorVars(author ?? 'unknown')}>
        {imageRefOf(change.before) !== imageRefOf(change.after) && (
          <p className="review-img">
            {thumb(change.before, 'Before')}
            <span aria-hidden="true">→</span>
            {thumb(change.after, 'After')}
          </p>
        )}
        <Attrs attrs={subs} fields={change.field.fields} by={by} />
      </div>
    )
  }
  // Rich text: only the changed blocks, in their own style, marks kept (Sanity's).
  const blocksOf = (v: unknown) => (v as {blocks?: DocBlock[]} | undefined)?.blocks
  if (Array.isArray(blocksOf(change.before)) || Array.isArray(blocksOf(change.after)))
    return <BlocksDiff before={blocksOf(change.before)} after={blocksOf(change.after)} author={author} t={t} />
  // A reference: the document it pointed to → the one it points to, as Sanity's.
  if (change.field.type === 'reference' && (refId(change.before) || refId(change.after)))
    return (
      <p className="review-diff review-fromto" style={userColorVars(author ?? 'unknown')}>
        {refId(change.before) && <del title={by('Removed')}><RefLabel id={refId(change.before)!} field={change.field} /></del>}
        {refId(change.before) && refId(change.after) && <span className="review-arrow" aria-label={t('changed to')}>→</span>}
        {refId(change.after) && <ins title={by('Added')}><RefLabel id={refId(change.after)!} field={change.field} /></ins>}
      </p>
    )
  // An array: each item added, removed or moved, as Sanity's array diff.
  if (Array.isArray(change.before) || Array.isArray(change.after)) {
    const items = arrayDiff((change.before ?? []) as unknown[], (change.after ?? []) as unknown[]).filter((x) => x.kind !== 'kept')
    return (
      <ul className="review-diff review-array" style={userColorVars(author ?? 'unknown')}>
        {items.map(({item, kind}, i) => {
          const label = <ItemLabel item={item} field={change.field} />
          return (
            <li key={i} data-kind={kind}>
              {kind === 'added' ? <ins title={by('Added')}>{label}</ins> : kind === 'removed' ? <del title={by('Removed')}>{label}</del> : <span>{label}</span>}
              {kind === 'moved' && <span className="review-moved">{t('Moved')}</span>}
            </li>
          )
        })}
      </ul>
    )
  }
  const before = asText(change.before)
  const after = asText(change.after)
  if (before === undefined || after === undefined)
    return <p className="review-diff muted">{change.before === undefined ? t('Added') : change.after === undefined ? t('Removed') : t('Changed')}</p>
  // A slug is replaced, not edited word by word: Sanity shows it from → to.
  if (change.field.type === 'slug')
    return (
      <p className="review-diff review-fromto" style={userColorVars(author ?? 'unknown')}>
        <del title={by('Removed')}>{before}</del>
        <span className="review-arrow" aria-label={t('changed to')}>→</span>
        <ins title={by('Added')}>{after}</ins>
      </p>
    )
  return (
    <p className="review-diff" style={userColorVars(author ?? 'unknown')}>
      {textDiff(before, after).map((s, i) =>
        // Who did it, in the segment's tooltip (Sanity: "Added" / "Removed" with the author).
        s.kind === 'removed' ? <del key={i} title={by('Removed')}>{s.text}</del> : s.kind === 'added' ? <ins key={i} title={by('Added')}>{s.text}</ins> : <span key={i}>{s.text}</span>,
      )}
    </p>
  )
}

/** A referenced document by its preview title. */
function RefLabel({id, field}: {id: string; field: Field}) {
  const t = useT()
  const {data: schemas = []} = useQuery(schemasQuery)
  const types = refTypesOf(field.type === 'reference' ? field : field.of)
  const {data: target} = useQuery({...docQuery(types, id), enabled: types.length > 0})
  return <>{target ? previewTitle(target, schemaOf(schemas, target._type), t) : id}</>
}

/** One array item, as its row in the form reads: a reference's title, an object's preview, a value. */
function ItemLabel({item, field}: {item: unknown; field: Field}) {
  if (item === null || typeof item !== 'object') return <>{String(item)}</>
  const of = field.of ?? field
  if (of.type === 'reference' || typeof (item as {_ref?: unknown})._ref === 'string') return <RefLabel id={refId(item)!} field={of.type === 'reference' ? of : field} />
  return <ObjectLabel item={item as Record<string, unknown>} of={of} />
}
function ObjectLabel({item, of}: {item: Record<string, unknown>; of: Field}) {
  return <>{useItemPreview(item as never, of).title}</>
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
    if (x.change === 'formatted') return <span key={i} className="review-formatted" title={author ? t('Formatting changed by {author}', {author}) : t('Formatting changed')}>{node}</span>
    return x.change === 'removed' ? <del key={i} title={by('Removed')}>{node}</del> : x.change === 'added' ? <ins key={i} title={by('Added')}>{node}</ins> : <span key={i}>{node}</span>
  }
  const changes = docDiff(before, after)
  // A picture block: before → after, as the image field's diff.
  const src = (b?: DocBlock) => (b ? (imageRefOf(b) ? `${assetUrl(imageRefOf(b)!)}?size=thumb` : typeof b.url === 'string' ? b.url : undefined) : undefined)
  const pic = (s: string | undefined, what: 'Before' | 'After') => (s ? <img src={s} alt={t(what)} /> : <span className="review-img-none">{t('No image')}</span>)
  return (
    <div className="review-diff review-blocks" style={userColorVars(author ?? 'unknown')}>
      {changes.map(({kind, block: b, was, pieces, items, attrs = []}) => {
        const body = pieces.map(piece)
        const k = `${kind}-${b.id}`
        const rest = <Attrs attrs={attrs.filter((a) => !(b.type === 'image' && ['url', 'asset', 'assetId'].includes(a.name)))} by={by} />
        if (b.type === 'image')
          return (
            <div key={k} data-change={kind}>
              <p className="review-img">
                {kind === 'added' ? <ins title={by('Added')}>{pic(src(b), 'After')}</ins> : kind === 'removed' ? <del title={by('Removed')}>{pic(src(b), 'Before')}</del> : src(was) !== src(b) ? <>{pic(src(was), 'Before')}<span aria-hidden="true">→</span>{pic(src(b), 'After')}</> : pic(src(b), 'After')}
              </p>
              {rest}
            </div>
          )
        if (attrs.length)
          return (
            <div key={k} data-change={kind}>
              {block(b, kind, body, items)}
              {rest}
            </div>
          )
        return <Fragment key={k}>{block(b, kind, body, items)}</Fragment>
      })}
    </div>
  )
  function block(b: DocBlock, kind: string, body: ReactNode, items?: Piece[][]) {
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
  }
}

/** A block's or an image's other properties that changed: name, then before → after. */
function Attrs({attrs, fields, by}: {attrs: AttrChange[]; fields?: Field[]; by: (what: string) => string}) {
  const t = useT()
  const NAMES: Record<string, string> = {tone: t('Tone'), level: t('Level'), alt: t('Alternative text'), caption: t('Caption'), hotspot: t('Hotspot'), crop: t('Crop')}
  const show = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : typeof v === 'object' ? null : String(v))
  return (
    <>
      {attrs.map(({name, before, after}) => {
        const label = fields?.find((f) => f.name === name)?.title ?? NAMES[name] ?? name
        const [b, a] = [show(before), show(after)]
        return (
          <p key={name} className="review-attr">
            <span className="review-attr-name">{label}</span>
            {b === null || a === null ? (
              <span className="muted">{t('Changed')}</span>
            ) : (
              <>
                <del title={by('Removed')}>{b}</del>
                <span className="review-arrow" aria-hidden="true">→</span>
                <ins title={by('Added')}>{a}</ins>
              </>
            )}
          </p>
        )
      })}
    </>
  )
}

/** Sanity's From / To picker: the range end as text; open, the timeline to pick another from. */
function RangePicker({label, text, options, selected, more, onPick}: {label: string; text: string; options: HistoryEntry[]; selected?: HistoryEntry; more?: {loading: boolean; load: () => void}; onPick: (e: HistoryEntry) => void}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  // Older revisions load as the list reaches its end, as Sanity's.
  const end = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (!open || !end.current || !more) return
    const seen = new IntersectionObserver(([e]) => e?.isIntersecting && !more.loading && more.load())
    seen.observe(end.current)
    return () => seen.disconnect()
  })
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
            {more && (
              <li ref={end} className="history-more muted" role="status">
                {t('Loading history…')}
              </li>
            )}
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
