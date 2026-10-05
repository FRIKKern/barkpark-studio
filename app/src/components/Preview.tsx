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

export function DocPreview({doc, href, selected, active, testId}: {doc: Doc | null | undefined; href: string; testId?: string} & Sel) {
  const {data: schemas = []} = useQuery(schemasQuery)
  const subtitle = useSubtitle(doc)
  return (
    <PaneLink href={href} className="preview" aria-current={selected && !!active} data-selected={selected ? '' : undefined} data-testid={testId}>
      <span className="media">
        <DocumentIcon />
      </span>
      <span className="text">
        <div className="t">{doc ? previewTitle(doc, schemaOf(schemas, doc._type)) : '…'}</div>
        {subtitle && <div className="s">{subtitle}</div>}
      </span>
      {doc && <span className={doc._draft ? 'dot draft' : 'dot'} />}
    </PaneLink>
  )
}

/** Preview of a referenced doc, fetched by id (usually already cached). */
export function RefPreview({type, id, href, selected, active}: {type: string; id: string; href: string} & Sel) {
  const {data} = useQuery(docQuery(type, id))
  return <DocPreview doc={data} href={href} selected={selected} active={active} />
}
