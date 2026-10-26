import {useZone} from '../lib/now'
import {createContext, memo, useContext, useState, type ReactNode} from 'react'
import {frame, imageRef, imageSrc, sanityImageId, NO_CROP, NO_HOTSPOT, THUMB_PX, type ImageValue} from '../lib/image'
import {useQueries, useQuery, useQueryClient, type QueryClient} from '@tanstack/react-query'
import {anyDocQuery, cachedDoc, docQuery, ensureAnyDocs, previewTitle, refId, refTypesOf, schemaOf, schemasQuery, type Doc, type Schema} from '../lib/data'
import {formatPreview, loadRefs, mediaRefs, previewRefs, readPath, rowMedia, textRefs, type PreviewMediaSpec, type PreviewMedia, type PreviewText} from '../lib/preview'
import {DocumentIcon, BrokenImageIcon} from './icons'
import {DeskIcon} from './DeskIcon'
import {PaneLink} from './PaneLink'
import {ago, useLocale, useT, useWorkspaceZone} from '../lib/i18n'
import {useTip} from './Tip'

/**
 * Whether a row may read a document its preview paths cross on its own. A list reads them
 * for all its rows in batches first, one batch per reference depth (lib/prime.ts
 * usePrimed), and says when each is in; a row anywhere else reads its own.
 */
export const RefsPrimed = createContext<(id: string) => boolean>(() => true)

/**
 * Subtitle per the schema's list_preview.subtitle: a path ("author.name", up to five
 * references deep: "parent.parent.title") or prepared parts with a fallback (J56,
 * lib/preview.ts). Each target loaded can name the next, so the hook subscribes to every
 * id the paths have crossed so far. A reference field's own target is read typed
 * (`docQuery`), which live updates refresh; deeper ones through `anyDocQuery`.
 */
function useSubtitle(doc: Doc | null | undefined) {
  const {data: schemas = []} = useQuery(schemasQuery)
  const qc = useQueryClient()
  const primed = useContext(RefsPrimed)
  const schema = doc ? schemaOf(schemas, doc._type) : undefined
  const spec = schema?.listPreview?.subtitle
  const deref = cachedDoc(qc)
  const typed = new Map(
    previewRefs(spec).flatMap((name) => {
      const id = refId(doc?.[name])
      const types = refTypesOf(schema?.fields.find((f) => f.name === name))
      return id && types.length ? [[id, types] as const] : []
    }),
  )
  const ids = spec && doc ? textRefs(spec, doc, deref) : []
  const zone = useWorkspaceZone()
  useQueries({queries: ids.map((id) => ({...(typed.has(id) ? docQuery(typed.get(id)!, id) : anyDocQuery(id)), enabled: primed(id)}))})
  if (!spec || !doc) return undefined
  return subtitleOf(spec, doc, deref, zone)
}

/** The subtitle from its spec: a field of the doc, or one a reference chain leads to. `zone`: the workspace's, for `|date`. */
function subtitleOf(spec: PreviewText, doc: Doc, deref: (id: string) => unknown, zone?: string) {
  return formatPreview(spec, (path) => readPath(doc, path, deref), {deref, zone})
}

/** The same subtitle outside React (the canvas's link card), its references read through `qc`, one batch per depth. */
export async function previewSubtitle(qc: QueryClient, doc: Doc, schema: Schema | undefined, zone?: string) {
  const spec = schema?.listPreview?.subtitle
  if (!spec) return undefined
  const deref = cachedDoc(qc)
  await loadRefs(() => textRefs(spec, doc, deref), (id) => deref(id) !== undefined, (ids) => ensureAnyDocs(qc, ids)).catch(() => {})
  return subtitleOf(spec, doc, deref, zone)
}

/**
 * A row's media candidates (lib/preview.ts rowMedia), reading the documents its media
 * paths cross (`heroImage.asset.url`) from `anyDocQuery`'s cache. Each one loaded can
 * name the next, so the hook subscribes to every id the paths have crossed so far.
 */
function useRowMedia(spec: PreviewMediaSpec | undefined, doc: Doc | null | undefined) {
  const qc = useQueryClient()
  const primed = useContext(RefsPrimed)
  const deref = cachedDoc(qc)
  const ids = spec && doc ? mediaRefs(spec, doc, deref) : []
  useQueries({queries: ids.map((id) => ({...anyDocQuery(id), enabled: primed(id)}))})
  return spec && doc ? rowMedia(spec, doc, deref) : []
}

// Like Sanity: the item whose pane is open next is grey; blue only when that pane is the last one.
type Sel = {selected: boolean; active?: boolean}

/**
 * Without `href` it renders as a plain row (e.g. a search option). Memo: a list
 * re-renders on every pane change, and its rows mostly stay the same.
 */
/** `iconless`: no document icon in place of media (Sanity's Incoming references rows); real media still shows. */
export const DocPreview = memo(function DocPreview({doc, href, selected, active, testId, badge, extra, iconless}: {doc: Doc | null | undefined; href?: string; testId?: string; badge?: string; extra?: ReactNode; iconless?: boolean} & Sel) {
  const {data: schemas = []} = useQuery(schemasQuery)
  const subtitle = useSubtitle(doc)
  const t = useT()
  const schema = doc ? schemaOf(schemas, doc._type) : undefined
  const title = doc ? previewTitle(doc, schema, t) : '…'
  // The schema's list_preview.media: an image field or an image URL shows as the row's
  // thumbnail, like Sanity. A list of paths is tried in order (lib/preview.ts rowMedia).
  const candidates = useRowMedia(schema?.listPreview?.media, doc)
  const showMedia = !iconless || candidates.length > 0
  const body = (
    <>
      {showMedia && (
        <span className="media">
          <RowMedia key={candidates.map(mediaKey).join(' ')} candidates={candidates} iconless={iconless} fallback={<TypeIcon schema={schema} />} />
        </span>
      )}
      <span className="text">
        <div className="t">{title}</div>
        {subtitle && <div className="s">{subtitle}</div>}
      </span>
      {badge && <span className="badge">{badge}</span>}
      {extra}
      {doc && <Status doc={doc} />}
    </>
  )
  if (!href) return <div className="preview">{body}</div>
  return (
    <PaneLink href={href} className="preview" aria-current={selected && !!active} data-selected={selected ? '' : undefined} data-testid={testId}>
      {body}
    </PaneLink>
  )
})

const mediaKey = ({media}: {media: PreviewMedia}) => (media.kind === 'image' ? media.ref : media.kind === 'url' ? media.src : media.kind)

/**
 * What a row with no media draws, as Sanity's: its type's icon (the schema's `icon`, sent
 * with its body), else the document icon. Also an array item's, by its member's named type.
 */
export function TypeIcon({schema}: {schema: Pick<Schema, 'icon' | 'iconSvg'> | undefined}) {
  return schema?.icon && schema.iconSvg ? <DeskIcon name={schema.icon} svg={schema.iconSvg} /> : <DocumentIcon />
}

/**
 * The first of a row's media that draws: an image value, an image URL, or the
 * broken-image icon for an asset value the studio can't show. An image URL that fails to
 * load gives way to the next candidate, and after the last to `fallback`, the type's icon
 * (none when the row is iconless).
 */
function RowMedia({candidates, iconless, fallback}: {candidates: {value: unknown; media: PreviewMedia}[]; iconless?: boolean; fallback: ReactNode}) {
  const [failed, setFailed] = useState(0)
  const t = useT()
  const c = candidates[failed]
  if (!c) return iconless ? null : fallback
  // An icon a stored value picks, in place of the type's icon; a name the studio cannot draw keeps the type's.
  if (c.media.kind === 'icon') return <DeskIcon name={c.media.name} fallback={fallback} />
  if (c.media.kind === 'image') return <Thumb value={c.value as ImageValue} fallback={fallback} />
  if (c.media.kind === 'url') return <UrlThumb key={failed} src={c.media.src} onFail={() => setFailed(failed + 1)} />
  if (c.media.kind === 'unsupported')
    return (
      <span className="media-broken" role="img" aria-label={t('Unsupported asset value')} title={`${t('Unsupported asset value')}: ${c.media.source}`}>
        <BrokenImageIcon />
      </span>
    )
  return fallback
}

/**
 * An image URL as a square thumbnail, cut to cover the square. Sent with no referrer:
 * the image host learns nothing about the studio. A load failure (also one before
 * hydration, seen as the img mounts) calls `onFail`.
 */
function UrlThumb({src, onFail}: {src: string; onFail: () => void}) {
  return (
    <>
      <img
        className="url-thumb"
        ref={(img) => void (img?.complete && !img.naturalWidth && onFail())}
        src={src}
        alt=""
        decoding="async"
        referrerPolicy="no-referrer"
        onError={onFail}
        data-testid="row-media-url"
      />
      <span data-border="" />
    </>
  )
}

/** An image value as a square thumbnail: its crop, cut to the square around the hotspot (Sanity's image URL rules). */
export function Thumb({value, fallback = <DocumentIcon />}: {value: ImageValue; fallback?: ReactNode}) {
  const [natural, setNatural] = useState<{width: number; height: number}>()
  const [failed, setFailed] = useState<string>()
  const t = useT()
  const ref = imageRef(value)
  if (!ref) return fallback
  // A Sanity image id Barkpark has no file for: the broken-image icon, as for any asset
  // value the studio can't show (lib/preview.ts previewMedia).
  if (failed === ref && sanityImageId(ref))
    return (
      <span className="media-broken" role="img" aria-label={t('Unsupported asset value')} title={`${t('Unsupported asset value')}: ${ref}`}>
        <BrokenImageIcon />
      </span>
    )
  const f = natural && frame(value.crop ?? NO_CROP, value.hotspot ?? NO_HOTSPOT, natural, 1)
  const measure = (img: HTMLImageElement) => setNatural({width: img.naturalWidth, height: img.naturalHeight})
  // The span after it is Sanity's faint edge over the image (styles.css [data-border]).
  return (
    <>
      <img
        // A server-rendered thumbnail can load (or fail) before hydration, and its event
        // is then missed: measure it as it mounts, or it stays hidden (blank row).
        ref={(img) => void (img?.complete && !natural && (img.naturalWidth ? measure(img) : failed !== ref && setFailed(ref)))}
        src={imageSrc(ref, THUMB_PX)}
        alt=""
        decoding="async"
        onError={() => setFailed(ref)}
        onLoad={(e) => measure(e.currentTarget)}
        style={f ? {width: `${100 / f.width}%`, height: `${100 / f.height}%`, left: `${(-f.left / f.width) * 100}%`, top: `${(-f.top / f.height) * 100}%`} : {opacity: 0}}
      />
      <span data-border="" />
    </>
  )
}

/** Preview of a referenced doc, fetched by id (usually already cached). */
export function RefPreview({type, id, href, selected, active, primed = true}: {type: string; id: string; href: string; primed?: boolean} & Sel) {
  const {data} = useQuery({...docQuery(type, id), enabled: primed})
  return <DocPreview doc={data} href={href} selected={selected} active={active} />
}

/**
 * A row's status dots with Sanity's tooltip (J56): "Published 3 hr. ago" or "Not
 * published", then "Edited just now" or "No unpublished edits".
 */
export function Status({doc}: {doc: Doc}) {
  const t = useT()
  const locale = useLocale()
  const zone = useZone()
  const published = doc._hasPublished !== false
  const line = (label: string, when: string, dot: string) => (
    <span className="tip-status">
      <span>
        <b>{label}</b>
        <span className="muted">{when}</span>
      </span>
      <span className={dot} />
    </span>
  )
  const {anchor, tip} = useTip(() => (
    <>
      {line(t('Published'), published ? (doc._publishedAt ? t('Published {ago}', {ago: ago(doc._publishedAt, locale, undefined, zone)}) : t('Published')) : t('Not published'), published ? 'dot published' : 'dot off')}
      {line(t('Draft'), doc._draft ? t('Edited {ago}', {ago: ago(doc._updatedAt, locale, undefined, zone)}) : t('No unpublished edits'), doc._draft ? 'dot draft' : 'dot off')}
    </>
  ))
  return (
    <span className="status" {...anchor} data-testid="row-status">
      {doc._draft && <span className="ring" />}
      {published && <span className="dot" />}
      {tip}
    </span>
  )
}
