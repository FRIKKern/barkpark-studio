import {useCallback, useContext, useEffect, useRef, useState} from 'react'
import {DialogBox, PaneOverlay} from './FocusScopes'
import {useQueries, useQuery} from '@tanstack/react-query'
import {docQuery, previewTitle, refId, refTypesOf, schemaOf, schemasQuery, type Field} from '../lib/data'
import {formatPreview, previewMedia, previewRefs, type PreviewText} from '../lib/preview'
import {imageRef, type ImageValue} from '../lib/image'
import {Thumb} from './Preview'
import {copy} from '../lib/clipboard'
import {FieldView, UrlPathContext, type OpenRef} from './Fields'
import {SortableRows} from './SortableRows'
import {Close as CloseIcon, DocumentIcon} from './icons'
import {translate, useLocale, useT} from '../lib/i18n'

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
  const typing = memberTypes(of)
  const [editing, setEditing] = useState<string | null>(null)
  const index = items.findIndex((it) => it._key === editing)
  // J52: a link to a field inside an item (path=links[_key=="l1"].title, or Sanity's
  // path=links[_key=="l1"]) opens that item's dialog; the pane then focuses the field.
  const urlPath = useContext(UrlPathContext)
  const wantKey = urlPath?.startsWith(`${id}[_key=="`) ? urlPath.slice(id.length + 8).split('"]')[0] : undefined
  // Once per item: closing the dialog puts focus (and so the URL) back on the item's
  // row, which must not open it again. Any open counts, a click's too.
  const openedFor = useRef<string | undefined>(undefined)
  useEffect(() => void (editing && (openedFor.current = editing)), [editing])
  useEffect(() => {
    if (!wantKey || wantKey === openedFor.current || !items.some((it) => it._key === wantKey)) return
    openedFor.current = wantKey
    setEditing(wantKey)
    // Only when the URL names another item, not on every edit of this one.
  }, [wantKey])
  const set = (next: Item[]) => onChange(next)
  // Steady, so a row re-renders only when its own item changes (J44: 300 rows).
  const renderItem = useCallback((it: Item) => <ItemRow item={it} of={of} onOpen={() => setEditing(it._key ?? null)} />, [of])
  return (
    <>
      <SortableRows
        id={id}
        items={items}
        onChange={set}
        readOnly={readOnly}
        keyOf={(it, i) => it._key ?? i}
        itemId={(it, i) => (it._key ? `${id}[_key=="${it._key}"]` : `${id}[${i}]`)}
        blank={(type) => ({...of.initialValue, ...(typing && type ? {[typing.field]: type} : {}), _key: newKey()})}
        types={typing?.types}
        duplicate={(it) => ({...it, _key: newKey()})}
        onAdded={(i, next) => setEditing(next[i]!._key ?? null)}
        onCopy={(it, i) => copy({kind: 'field', field: {name: `${id}[${i}]`, sig: 'object', value: it}})}
        addLabel="Add item..."
        renderItem={renderItem}
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

/**
 * J33 (decision 0005): several item types in one Barkpark arrayOf (it takes one member shape until
 * task-b3ebbd3ab1575e2a). The member says which select names the type and which fields
 * each type has: `options: {typeField: "kind", fieldsByType: {externalLink: ["title", "url"]}}`.
 * Then adding asks the type (Sanity's insert menu) and an item shows its type's fields
 * only. Barkpark's LiveView ignores these options and shows the select and every field.
 */
type Typing = {field: string; types: {value: string; title: string}[]; fieldsByType: Record<string, string[]>}
function memberTypes(of: Field): Typing | undefined {
  const o = (Array.isArray(of.options) ? undefined : of.options) as {typeField?: string; fieldsByType?: Record<string, string[]>} | undefined
  const select = of.fields?.find((f) => f.name === o?.typeField)
  const list = select && Array.isArray(select.options) ? (select.options as {value: string; title?: string}[]) : undefined
  if (!o?.typeField || !o.fieldsByType || !list) return undefined
  return {field: o.typeField, types: list.map((t) => ({value: t.value, title: t.title ?? t.value})), fieldsByType: o.fieldsByType}
}

/** The fields an item shows: its type's, without the type select; all of them when it has no type. */
function fieldsOf(of: Field, item: Item): Field[] {
  const typing = memberTypes(of)
  const names = typing && typeof item[typing.field] === 'string' ? typing.fieldsByType[item[typing.field] as string] : undefined
  return names ? names.map((n) => of.fields?.find((f) => f.name === n)).filter((f): f is Field => !!f) : of.fields ?? []
}

/**
 * An item's preview (J33, J56): title, subtitle and media per the member's
 * `preview`, read like a list preview (lib/preview.ts). A path may go through one
 * reference ("linkedDocument.title"); a bare reference field reads as the
 * referenced doc's preview title, as Sanity's does.
 */
export function useItemPreview(item: Item, of: Field) {
  const locale = useLocale()
  const {data: schemas = []} = useQuery(schemasQuery)
  const p = of.preview ?? {}
  const titleSpec: PreviewText | undefined = p.title ?? of.fields?.find((f) => f.type === 'string')?.name
  const specs = [titleSpec, p.subtitle, p.media]
  const fieldOf = (name: string) => of.fields?.find((f) => f.name === name)
  const bare = specs.flatMap((s) => (typeof s === 'string' ? [s] : [])).filter((s) => !s.includes('.') && fieldOf(s)?.type === 'reference')
  const refs = [...new Set([...previewRefs(...specs), ...bare])].map((name) => ({name, id: refId(item[name]), types: refTypesOf(fieldOf(name))}))
  const targets = useQueries({queries: refs.map((r) => ({...docQuery(r.types, r.id ?? ''), enabled: !!r.id && r.types.length > 0}))})
  const read = (path: string) => {
    const [head, ...rest] = path.split('.')
    const r = refs.findIndex((x) => x.name === head)
    if (r < 0) return rest.reduce<unknown>((v, k) => (v as Record<string, unknown> | null | undefined)?.[k], item[head!])
    const target = targets[r]?.data
    if (!rest.length) return target ? previewTitle(target, schemaOf(schemas, target._type)) : undefined
    return rest.reduce<unknown>((v, k) => (v as Record<string, unknown> | null | undefined)?.[k], target)
  }
  const typeTitle = (type: string) => schemaOf(schemas, type)?.title
  return {
    title: formatPreview(titleSpec, read, {typeTitle}) || translate(locale, 'Untitled'),
    subtitle: formatPreview(p.subtitle, read, {typeTitle}),
    media: previewMedia(p.media, read, (v) => !!imageRef(v)) as ImageValue | undefined,
  }
}

function ItemRow({item, of, onOpen}: {item: Item; of: Field; onOpen: () => void}) {
  const {title, subtitle, media} = useItemPreview(item, of)
  return (
    <button type="button" className="array-item-preview" onClick={onOpen}>
      <span className={media ? 'media has-image' : 'media'}>{media ? <Thumb value={media} /> : <DocumentIcon />}</span>
      <span className="text">
        <span className="title">{title}</span>
        {subtitle && <span className="subtitle">{subtitle}</span>}
      </span>
    </button>
  )
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
  const t = useT()
  const {title} = useItemPreview(item, of)
  // Over the whole document pane, as the other dialogs (not over the field's box).
  return (
    <PaneOverlay>
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog item-dialog" aria-modal="true" aria-label={`${parentTitle} / ${title}`} onClose={onClose}>
        <header>
          <nav className="crumbs" aria-label={t('Breadcrumb')}>
            <button type="button" className="crumb" onClick={onClose}>
              {parentTitle}
            </button>
            <span aria-hidden>/</span>
            <span className="crumb current">
              <span className="muted">#{position}</span> {title}
            </span>
          </nav>
          <button type="button" className="icon-btn" aria-label={t('Close dialog')} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="dialog-body item-fields">
          <fieldset className="form-fields" disabled={readOnly}>
            {fieldsOf(of, item).map((f) => (
              <FieldView key={f.name} field={f} path={`${path}.${f.name}`} value={item[f.name]} openRef={openRef} onChange={(v) => onChange({...item, [f.name]: v})} />
            ))}
          </fieldset>
        </div>
      </DialogBox>
    </div>
    </PaneOverlay>
  )
}
