import {memo, useState, type ReactNode} from 'react'
import {assetUrl, frame, NO_CROP, NO_HOTSPOT, type ImageValue} from '../lib/image'
import {useQueries, useQuery} from '@tanstack/react-query'
import {docQuery, previewTitle, refId, refTypesOf, schemaOf, schemasQuery, type Doc} from '../lib/data'
import {formatPreview, previewRefs} from '../lib/preview'
import {DocumentIcon} from './icons'
import {PaneLink} from './PaneLink'
import {ago} from './HistoryPanel'
import {useLocale, useT} from '../lib/i18n'
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
  return formatPreview(spec, (path) => {
    const [head, ...rest] = path.split('.')
    if (!rest.length) return doc[head!]
    const target = targets[refs.findIndex((r) => r.name === head)]?.data
    return rest.reduce<unknown>((v, k) => (v as Record<string, unknown> | null | undefined)?.[k], target)
  })
}

// Like Sanity: the item whose pane is open next is grey; blue only when that pane is the last one.
type Sel = {selected: boolean; active?: boolean}

/**
 * Without `href` it renders as a plain row (e.g. a search option). Memo: a list
 * re-renders on every pane change, and its rows mostly stay the same.
 */
export const DocPreview = memo(function DocPreview({doc, href, selected, active, testId, badge, extra}: {doc: Doc | null | undefined; href?: string; testId?: string; badge?: string; extra?: ReactNode} & Sel) {
  const {data: schemas = []} = useQuery(schemasQuery)
  const subtitle = useSubtitle(doc)
  const t = useT()
  // previewTitle's 'Untitled' is a placeholder, said in the editor's language; a real title never is.
  const title = doc ? previewTitle(doc, schemaOf(schemas, doc._type)) : '…'
  // The schema's list_preview.media: an image field shows as the row's thumbnail, like Sanity.
  const mediaKey = doc ? schemaOf(schemas, doc._type)?.listPreview?.media : undefined
  const media = mediaKey ? (doc?.[mediaKey] as ImageValue | undefined) : undefined
  const body = (
    <>
      <span className="media">{media ? <Thumb value={media} /> : <DocumentIcon />}</span>
      <span className="text">
        <div className="t">{title === 'Untitled' ? t('Untitled') : title}</div>
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
function Thumb({value}: {value: ImageValue}) {
  const [natural, setNatural] = useState<{width: number; height: number}>()
  const ref = value.asset?._ref
  if (!ref) return <DocumentIcon />
  const f = natural && frame(value.crop ?? NO_CROP, value.hotspot ?? NO_HOTSPOT, natural, 1)
  const measure = (img: HTMLImageElement) => setNatural({width: img.naturalWidth, height: img.naturalHeight})
  return (
    <img
      // A server-rendered thumbnail can load before hydration, and its load event
      // is then missed: measure it as it mounts, or it stays hidden (blank row).
      ref={(img) => void (img?.complete && img.naturalWidth && !natural && measure(img))}
      src={`${assetUrl(ref)}?size=thumb`}
      alt=""
      onLoad={(e) => measure(e.currentTarget)}
      style={f ? {width: `${100 / f.width}%`, height: `${100 / f.height}%`, left: `${(-f.left / f.width) * 100}%`, top: `${(-f.top / f.height) * 100}%`} : {opacity: 0}}
    />
  )
}

/** Preview of a referenced doc, fetched by id (usually already cached). */
export function RefPreview({type, id, href, selected, active}: {type: string; id: string; href: string} & Sel) {
  const {data} = useQuery(docQuery(type, id))
  return <DocPreview doc={data} href={href} selected={selected} active={active} />
}

/**
 * A row's status dots with Sanity's tooltip (J56): "Published 3 hr. ago" or "Not
 * published", then "Edited just now" or "No unpublished edits".
 */
function Status({doc}: {doc: Doc}) {
  const t = useT()
  const locale = useLocale()
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
      {line(t('Published'), published ? (doc._publishedAt ? t('Published {ago}', {ago: ago(doc._publishedAt, locale)}) : t('Published')) : t('Not published'), published ? 'dot published' : 'dot off')}
      {line(t('Draft'), doc._draft ? t('Edited {ago}', {ago: ago(doc._updatedAt, locale)}) : t('No unpublished edits'), doc._draft ? 'dot draft' : 'dot off')}
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
