import {memo, type ReactNode} from 'react'
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
  const body = (
    <>
      <span className="media">
        <DocumentIcon />
      </span>
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

/** Preview of a referenced doc, fetched by id (usually already cached). */
export function RefPreview({type, id, href, selected, active}: {type: string; id: string; href: string} & Sel) {
  const {data} = useQuery(docQuery(type, id))
  return <DocPreview doc={data} href={href} selected={selected} active={active} />
}
