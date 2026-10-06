import {useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {docQuery, previewTitle, schemaOf, schemasQuery, type Field} from '../lib/data'
import {copy} from '../lib/clipboard'
import {FieldView, type OpenRef} from './Fields'
import {SortableRows} from './SortableRows'
import {Close as CloseIcon, DocumentIcon} from './icons'

// Arrays of objects (J33), after Sanity's: each item a row with a preview (the
// item's preview title/subtitle; a reference subtitle shows the referenced doc's
// title), opened for editing in a dialog over the pane with "Links / #1 Title"
// breadcrumbs. Items are keyed like Sanity's (_key), so the list keeps its rows
// steady while you reorder and edit. Barkpark's arrayOf takes one member type, so
// "Add item…" adds that type; Sanity's menu of several types waits on
// task-b3ebbd3ab1575e2a.

type Item = {_key?: string} & Record<string, unknown>
const newKey = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12)

export function ObjectArrayInput({id, field, value, onChange, readOnly, openRef}: {id: string; field: Field; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean; openRef: OpenRef}) {
  const items = (Array.isArray(value) ? value : []) as Item[]
  const of = field.of!
  const [editing, setEditing] = useState<string | null>(null)
  const index = items.findIndex((it) => it._key === editing)
  const set = (next: Item[]) => onChange(next)
  return (
    <>
      <SortableRows
        id={id}
        items={items}
        onChange={set}
        readOnly={readOnly}
        keyOf={(it, i) => it._key ?? i}
        blank={() => ({_key: newKey()})}
        duplicate={(it) => ({...it, _key: newKey()})}
        onAdded={(i, next) => setEditing(next[i]!._key ?? null)}
        onCopy={(it, i) => copy({kind: 'field', field: {name: `${id}[${i}]`, sig: 'object', value: it}})}
        addLabel="Add item..."
        renderItem={(it) => (
          <button type="button" className="array-item-preview" onClick={() => setEditing(it._key ?? null)}>
            <span className="media">
              <DocumentIcon />
            </span>
            <span className="text">
              <span className="title">{previewText(it, of, 'title') || 'Untitled'}</span>
              <Subtitle item={it} of={of} />
            </span>
          </button>
        )}
      />
      {index >= 0 && (
        <ItemDialog
          parentTitle={field.title ?? field.name}
          position={index + 1}
          item={items[index]!}
          of={of}
          path={`${id}[_key=="${items[index]!._key}"]`}
          readOnly={readOnly}
          openRef={openRef}
          onChange={(next) => set(items.map((it, i) => (i === index ? next : it)))}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

/** The item's preview text: its schema's preview path, else its first string field. */
function previewText(item: Item, of: Field, slot: 'title' | 'subtitle'): string {
  const path = of.preview?.[slot] ?? (slot === 'title' ? of.fields?.find((f) => f.type === 'string')?.name : undefined)
  const v = path ? item[path] : undefined
  return typeof v === 'string' ? v : ''
}

/** A subtitle that is a reference shows the referenced doc's title, as Sanity's preview does. */
function Subtitle({item, of}: {item: Item; of: Field}) {
  const name = of.preview?.subtitle
  const f = of.fields?.find((x) => x.name === name)
  const refId = f?.type === 'reference' && typeof item[name!] === 'string' ? (item[name!] as string) : undefined
  const {data: schemas = []} = useQuery(schemasQuery)
  const {data: target} = useQuery({...docQuery(f?.refType ?? '', refId ?? ''), enabled: !!refId})
  const text = refId ? (target ? previewTitle(target, schemaOf(schemas, target._type)!) : '') : previewText(item, of, 'subtitle')
  return text ? <span className="subtitle">{text}</span> : null
}

function ItemDialog({parentTitle, position, item, of, path, readOnly, openRef, onChange, onClose}: {
  parentTitle: string
  position: number
  item: Item
  of: Field
  path: string
  readOnly?: boolean
  openRef: OpenRef
  onChange: (item: Item) => void
  onClose: () => void
}) {
  const title = previewText(item, of, 'title') || 'Untitled'
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog item-dialog" role="dialog" aria-modal="true" aria-label={`${parentTitle} / ${title}`} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onClose())}>
        <header>
          <nav className="crumbs" aria-label="Breadcrumb">
            <button type="button" className="crumb" onClick={onClose}>
              {parentTitle}
            </button>
            <span aria-hidden>/</span>
            <span className="crumb current">
              <span className="muted">#{position}</span> {title}
            </span>
          </nav>
          <button type="button" className="icon-btn" aria-label="Close dialog" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="dialog-body item-fields">
          <fieldset className="form-fields" disabled={readOnly}>
            {of.fields?.map((f) => (
              <FieldView key={f.name} field={f} path={`${path}.${f.name}`} value={item[f.name]} openRef={openRef} onChange={(v) => onChange({...item, [f.name]: v})} />
            ))}
          </fieldset>
        </div>
      </div>
    </div>
  )
}
