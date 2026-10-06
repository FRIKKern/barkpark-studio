import {memo, useState, type ReactNode} from 'react'
import {assetUrl, frame, NO_CROP, NO_HOTSPOT, type ImageValue} from '../lib/image'
import {useQuery} from '@tanstack/react-query'
import {docQuery, previewTitle, schemaOf, schemasQuery, type Doc} from '../lib/data'
import {DocumentIcon} from './icons'
import {PaneLink} from './PaneLink'

/** Subtitle per the schema's list_preview.subtitle, e.g. "author.name" follows one reference. */
function useSubtitle(doc: Doc | null | undefined) {
  const {data: schemas = []} = useQuery(schemasQuery)
  const spec = doc ? schemaOf(schemas, doc._type)?.listPreview?.subtitle : undefined
  const [refField, key] = spec?.includes('.') ? spec.split('.') : [undefined, spec]
  const refId = refField && doc ? (doc[refField] as string | undefined) : undefined
  const refType = refField && doc ? schemaOf(schemas, doc._type)?.fields.find((f) => f.name === refField)?.refType : undefined
  const {data: ref} = useQuery({...docQuery(refType ?? '', refId ?? ''), enabled: !!refId && !!refType})
  if (!spec || !doc) return undefined
  const v = refField ? ref?.[key!] : doc[key!]
  return typeof v === 'string' ? v : undefined
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
  // The schema's list_preview.media: an image field shows as the row's thumbnail, like Sanity.
  const mediaKey = doc ? schemaOf(schemas, doc._type)?.listPreview?.media : undefined
  const media = mediaKey ? (doc?.[mediaKey] as ImageValue | undefined) : undefined
  const body = (
    <>
      <span className="media">{media ? <Thumb value={media} /> : <DocumentIcon />}</span>
      <span className="text">
        <div className="t">{doc ? previewTitle(doc, schemaOf(schemas, doc._type)) : '…'}</div>
        {subtitle && <div className="s">{subtitle}</div>}
      </span>
      {badge && <span className="badge">{badge}</span>}
      {extra}
      {doc?._draft && <span className="ring" title="Draft" />}
      {doc?._hasPublished !== false && doc && <span className="dot" title="Published" />}
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
  return (
    <img
      src={`${assetUrl(ref)}?size=thumb`}
      alt=""
      onLoad={(e) => setNatural({width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight})}
      style={f ? {width: `${100 / f.width}%`, height: `${100 / f.height}%`, left: `${(-f.left / f.width) * 100}%`, top: `${(-f.top / f.height) * 100}%`} : {opacity: 0}}
    />
  )
}

/** Preview of a referenced doc, fetched by id (usually already cached). */
export function RefPreview({type, id, href, selected, active}: {type: string; id: string; href: string} & Sel) {
  const {data} = useQuery(docQuery(type, id))
  return <DocPreview doc={data} href={href} selected={selected} active={active} />
}
