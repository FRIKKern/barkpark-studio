import {useZone} from '../lib/now'
import {memo, useState, type ReactNode} from 'react'
import {frame, imageRef, imageSrc, sanityImageId, NO_CROP, NO_HOTSPOT, THUMB_PX, type ImageValue} from '../lib/image'
import {useQueries, useQuery, type QueryClient} from '@tanstack/react-query'
import {docQuery, previewTitle, refId, refTypesOf, schemaOf, schemasQuery, type Doc, type Schema} from '../lib/data'
import {formatPreview, previewRefs, previewMedia, type PreviewText} from '../lib/preview'
import {DocumentIcon, BrokenImageIcon} from './icons'
import {PaneLink} from './PaneLink'
import {ago, useLocale, useT} from '../lib/i18n'
import {useTip} from './Tip'

/**
 * Subtitle per the schema's list_preview.subtitle: a path ("author.name" follows
 * one reference) or prepared parts with a fallback (J56, lib/preview.ts).
 */
function useSubtitle(doc: Doc | null | undefined) {
  const {data: schemas = []} = useQuery(schemasQuery)
  const schema = doc ? schemaOf(schemas, doc._type) : undefined
  const spec = schema?.listPreview?.subtitle
  const refs = previewRefs(spec).map((name) => {
    const field = schema?.fields.find((f) => f.name === name)
    return {name, id: refId(doc?.[name]), types: refTypesOf(field)}
  })
  const targets = useQueries({queries: refs.map((r) => ({...docQuery(r.types, r.id ?? ''), enabled: !!r.id && r.types.length > 0}))})
  if (!spec || !doc) return undefined
  return subtitleOf(spec, doc, (name) => targets[refs.findIndex((r) => r.name === name)]?.data)
}

/** The subtitle from its spec: a field of the doc, or one of a document its reference names. */
function subtitleOf(spec: PreviewText, doc: Doc, target: (name: string) => unknown) {
  return formatPreview(spec, (path) => {
    const [head, ...rest] = path.split('.')
    if (!rest.length) return doc[head!]
    return rest.reduce<unknown>((v, k) => (v as Record<string, unknown> | null | undefined)?.[k], target(head!))
  })
}

/** The same subtitle outside React (the canvas's link card), its references read through `qc`. */
export async function previewSubtitle(qc: QueryClient, doc: Doc, schema: Schema | undefined) {
  const spec = schema?.listPreview?.subtitle
  if (!spec) return undefined
  const targets = new Map(
    await Promise.all(
      previewRefs(spec).map(async (name) => {
        const id = refId(doc[name])
        const types = refTypesOf(schema!.fields.find((f) => f.name === name))
        return [name, id && types.length ? await qc.fetchQuery(docQuery(types, id)).catch(() => undefined) : undefined] as const
      }),
    ),
  )
  return subtitleOf(spec, doc, (name) => targets.get(name))
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
  const title = doc ? previewTitle(doc, schemaOf(schemas, doc._type), t) : '…'
  // The schema's list_preview.media: an image field shows as the row's thumbnail, like Sanity.
  const mediaKey = doc ? schemaOf(schemas, doc._type)?.listPreview?.media : undefined
  const media = previewMedia(mediaKey ? doc?.[mediaKey] : undefined)
  const showMedia = !iconless || media.kind === 'image' || media.kind === 'unsupported'
  const body = (
    <>
      {showMedia && (
        <span className="media">
          {media.kind === 'image' ? (
            <Thumb value={doc![mediaKey!] as ImageValue} />
          ) : media.kind === 'unsupported' ? (
            <span className="media-broken" role="img" aria-label={t('Unsupported asset value')} title={`${t('Unsupported asset value')}: ${media.source}`}>
              <BrokenImageIcon />
            </span>
          ) : (
            <DocumentIcon />
          )}
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

/** An image value as a square thumbnail: its crop, cut to the square around the hotspot (Sanity's image URL rules). */
export function Thumb({value}: {value: ImageValue}) {
  const [natural, setNatural] = useState<{width: number; height: number}>()
  const [failed, setFailed] = useState<string>()
  const t = useT()
  const ref = imageRef(value)
  if (!ref) return <DocumentIcon />
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
  return (
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
