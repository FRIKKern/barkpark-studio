import {createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type DragEvent} from 'react'
import {DialogBox, PaneOverlay} from './FocusScopes'
import {useQueries, useQuery} from '@tanstack/react-query'
import {docQuery, previewTitle, refId, refTypesOf, schemaOf, schemasQuery, type Field, type Schema} from '../lib/data'
import {firstMedia, formatPreview, previewRefs, type PreviewText} from '../lib/preview'
import {imageRef, pickedImage, type ImageValue} from '../lib/image'
import {uploadFile, UploadError} from '../lib/upload'
import {uploadMeta} from '../lib/image-meta'
import {toast} from './Toasts'
import {Thumb, TypeIcon} from './Preview'
import {copyItem, signature} from '../lib/clipboard'
import {EditPathContext, FieldView, UrlPathContext, WriteUrlPathContext, type OpenRef, ParentContext} from './Fields'
import {SortableRows} from './SortableRows'
import {Close as CloseIcon, Upload} from './icons'
import {translate, useLocale, useT} from '../lib/i18n'
import {usePrimed} from '../lib/prime'
import {memberChoices, memberFor, memberName, memberPreview, membersOf, newMemberItem} from '../lib/array-members'

// Arrays of objects (J33), after Sanity's: each item a row with a preview (the
// item's preview title/subtitle; a reference subtitle shows the referenced doc's
// title), opened for editing in a dialog over the pane with "Links / #1 Title"
// breadcrumbs. Items are keyed like Sanity's (_key), so the list keeps its rows
// steady while you reorder and edit. "Add item" adds the one member type; with several
// (a typeField) it is Sanity's "Add item…" with a menu of them. An array whose `of` lists
// several members (a page builder, task-3da190705a269df1) draws each item with its own
// member's preview and icon, by the item's _type, and its "Add item…" menu lists the members.

type Item = {_key?: string} & Record<string, unknown>
type Crumb = {label: string; position: number; title: string; close: () => void}
/** The item dialogs open around this one, outermost first (an array inside an item). */
const DialogCrumbsContext = createContext<Crumb[]>([])
/** In an item dialog the author opened (not a link): the URL's path is from before, not to follow. */
const OpenedByHandContext = createContext(false)
const newKey = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12)

// An array of images takes several files dropped on it at once, as Sanity's: one item per
// file, uploaded UPLOAD_LANES at a time, each row its picture (from the file, at once), its
// progress and Cancel. A cancelled or failed upload takes its empty item away.
type Uploading = {name: string; progress: number; preview: string; cancel: () => void}
const UploadsContext = createContext<ReadonlyMap<string, Uploading>>(new Map())
// Whether an item's referenced docs have been read with the rest of the array's
// (task-3cd385d88d90944e): one read per item was an N+1. Outside an array: always.
const PrimedContext = createContext<(id: string) => boolean>(() => true)
const UPLOAD_LANES = 3
const imageFiles = (list: FileList) => [...list].filter((f) => f.type.startsWith('image/'))
const carriesFiles = (e: DragEvent<HTMLElement>) => [...e.dataTransfer.types].includes('Files')

export function ObjectArrayInput({id, field, value, onChange, readOnly, openRef}: {id: string; field: Field; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean; openRef: OpenRef}) {
  const items = (Array.isArray(value) ? value : []) as Item[]
  const members = useMemo(() => membersOf(field), [field.of])
  const multi = members.length > 1
  // One member: the array's `of` (a list of one is that one).
  const of = members[0]!
  const {data: schemas = []} = useQuery(schemasQuery)
  const memberOf = useCallback((it: Item) => memberFor(members, it) ?? unknownMember(it), [members])
  const typing = multi ? undefined : memberTypes(of)
  const choices = multi ? memberChoices(members, schemas) : typing?.types
  const primed = usePrimed(items.flatMap((it) => itemRefs(it, memberOf(it), schemas).flatMap((r) => (r.id && r.types.length ? [{types: r.types, id: r.id}] : []))))
  const [editing, setEditing] = useState<string | null>(null)
  const index = items.findIndex((it) => it._key === editing)
  // J52: a link to a field inside an item (path=links[_key=="l1"].title, or Sanity's
  // path=links[_key=="l1"]) opens that item's dialog; the pane then focuses the field.
  const urlPath = useContext(UrlPathContext)
  const wantKey = urlPath?.startsWith(`${id}[_key=="`) ? urlPath.slice(id.length + 8).split('"]')[0] : undefined
  // Once per item: closing the dialog puts focus (and so the URL) back on the item's
  // row, which must not open it again. Any open counts, a click's too.
  // An array in a dialog opened by hand takes the URL's path as done: closing an inner item
  // left it there, and reopening the outer one by click opened the inner one too (Sanity's doesn't).
  const openedFor = useRef<string | undefined>(useContext(OpenedByHandContext) ? wantKey : undefined)
  const [byLink, setByLink] = useState(false)
  useEffect(() => void (editing && (openedFor.current = editing)), [editing])
  // Opened by hand, the item names itself in the URL (a reload reopens it); closed, the URL goes
  // back to the item around this array, or to none (Sanity's: a reload brings back what was open).
  const writePath = useContext(WriteUrlPathContext)
  const open = useCallback((key: string | null) => (setEditing(key), setByLink(false), key && writePath?.(`${id}[_key=="${key}"]`)), [id, writePath])
  const close = () => {
    if (editing && urlPath?.startsWith(`${id}[_key=="${editing}"]`)) writePath?.(id.match(/^(.*\])\.[^\]]*$/)?.[1])
    setEditing(null)
  }
  useEffect(() => {
    if (!wantKey || wantKey === openedFor.current || !items.some((it) => it._key === wantKey)) return
    openedFor.current = wantKey
    setEditing(wantKey)
    setByLink(true)
    // Only when the URL names another item, not on every edit of this one.
  }, [wantKey])
  const set = (next: Item[]) => onChange(next)
  const t = useT()
  const editPath = useContext(EditPathContext)
  const latest = useRef(items)
  latest.current = items
  const [uploads, setUploads] = useState<ReadonlyMap<string, Uploading>>(() => new Map())
  const [over, setOver] = useState(false)
  const track = (key: string, change: ((u: Uploading) => Uploading) | null) =>
    setUploads((m) => {
      const u = m.get(key)
      const next = new Map(m)
      if (change && u) next.set(key, change(u))
      else next.delete(key)
      return next
    })
  const dropImages = (files: File[]) => {
    const queued = files.map((file) => ({file, key: newKey(), stop: new AbortController(), preview: URL.createObjectURL(file)}))
    setUploads((m) => new Map([...m, ...queued.map((q) => [q.key, {name: q.file.name, progress: 0, preview: q.preview, cancel: () => q.stop.abort()}] as const)]))
    onChange([...latest.current, ...queued.map((q) => ({_type: 'image', _key: q.key}))])
    const one = async ({file, key, stop, preview}: (typeof queued)[number]) => {
      try {
        if (stop.signal.aborted) throw new DOMException('Upload cancelled', 'AbortError')
        const ref = await uploadFile(file, (progress) => track(key, (u) => ({...u, progress})), stop.signal, uploadMeta(of.options))
        // Into its own item, by path: uploads finishing together never undo one another.
        if (editPath) editPath(`${id}[_key=="${key}"].asset`, {_ref: ref})
        else onChange(latest.current.map((it) => (it._key === key ? {...pickedImage(it, ref), _type: 'image', _key: key} : it)))
      } catch (err) {
        onChange(latest.current.filter((it) => it._key !== key))
        if ((err as Error).name !== 'AbortError')
          toast({tone: 'critical', title: t('Could not upload {name}', {name: file.name}), description: err instanceof UploadError && err.network ? t('The network is unreachable.') : (err as Error).message})
      } finally {
        URL.revokeObjectURL(preview)
        track(key, null)
      }
    }
    let next = 0
    const lane = async () => {
      while (next < queued.length) await one(queued[next++]!)
    }
    for (let i = 0; i < Math.min(UPLOAD_LANES, queued.length); i++) void lane()
  }
  const dropTarget =
    !multi && of.type === 'image' && !readOnly
      ? {
          onDragEnter: (e: DragEvent<HTMLElement>) => carriesFiles(e) && (e.preventDefault(), setOver(true)),
          onDragOver: (e: DragEvent<HTMLElement>) => carriesFiles(e) && e.preventDefault(),
          onDragLeave: (e: DragEvent<HTMLElement>) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(false),
          onDrop: (e: DragEvent<HTMLElement>) => {
            if (!carriesFiles(e)) return
            e.preventDefault()
            setOver(false)
            const files = imageFiles(e.dataTransfer.files)
            if (files.length) dropImages(files)
          },
        }
      : {}
  // Steady, so a row re-renders only when its own item changes (J44: 300 rows).
  const renderItem = useCallback((it: Item) => <ItemRow item={it} of={memberOf(it)} named={multi} onOpen={() => open(it._key ?? null)} />, [memberOf, multi, open])
  return (
    <PrimedContext.Provider value={primed}>
    <UploadsContext.Provider value={uploads}>
      <div className="array-drop" data-over={over || undefined} {...dropTarget}>
      {over && (
        <div className="drop-overlay" aria-live="polite">
          <Upload /> {t('Drop to upload')}
        </div>
      )}
      <SortableRows
        id={id}
        items={items}
        onChange={set}
        readOnly={readOnly}
        keyOf={(it, i) => it._key ?? i}
        itemId={(it, i) => (it._key ? `${id}[_key=="${it._key}"]` : `${id}[${i}]`)}
        blank={(type) =>
          multi
            ? newMemberItem(members.find((m) => memberName(m) === type) ?? of, newKey())
            : of.type === 'image'
              ? {_type: 'image', _key: newKey()}
              : {...of.initialValue, ...(typing && type ? {[typing.field]: type} : {}), _key: newKey()}
        }
        types={choices}
        duplicate={(it) => ({...it, _key: newKey()})}
        onAdded={(i, next) => open(next[i]!._key ?? null)}
        onDuplicated={(i, next) => open(next[i]!._key ?? null)}
        onCopy={(it, i) => copyItem(id, i, signature(field), it)}
        addLabel={choices ? 'Add item...' : 'Add item'}
        renderItem={renderItem}
        grid={field.layout === 'grid' || (!Array.isArray(field.options) && field.options?.layout === 'grid')}
      />
      {index >= 0 && (
        <OpenedByHandContext.Provider value={!byLink}>
        <ItemDialog
          parentTitle={field.title ?? field.name}
          position={index + 1}
          item={items[index]!}
          of={memberOf(items[index]!)}
          named={multi}
          path={`${id}[_key=="${items[index]!._key}"]`}
          readOnly={readOnly}
          openRef={openRef}
          onChange={(next) => set(items.map((it, i) => (i === index ? next : it)))}
          onClose={close}
        />
        </OpenedByHandContext.Provider>
      )}
      </div>
    </UploadsContext.Provider>
    </PrimedContext.Provider>
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
const itemTitleSpec = (of: Field, p: Field['preview']): PreviewText | undefined => p?.title ?? of.fields?.find((f) => f.type === 'string')?.name

/** An item whose _type no member names: its fields stay as they are, untouched. */
const unknownMember = (it: Item): Field => ({name: typeof it._type === 'string' ? it._type : '', type: 'composite', fields: []})

/** The references an item's preview reads: the preview's ref paths and bare reference fields. */
function itemRefs(item: Item, of: Field, schemas: Schema[]) {
  const p = memberPreview(of, schemas) ?? {}
  const specs = [itemTitleSpec(of, p), p.subtitle, p.media]
  const fieldOf = (name: string) => of.fields?.find((f) => f.name === name)
  const bare = specs.flatMap((s) => (typeof s === 'string' ? [s] : [])).filter((s) => !s.includes('.') && fieldOf(s)?.type === 'reference')
  return [...new Set([...previewRefs(...specs), ...bare])].map((name) => ({name, id: refId(item[name]), types: refTypesOf(fieldOf(name))}))
}

/**
 * `named`: the item is one of several member types (a page builder). With no title of its
 * own it takes its member's title, as the sections' previews in Sanity do, not "Untitled".
 */
export function useItemPreview(item: Item, of: Field, named = false) {
  const locale = useLocale()
  const t = useT()
  const {data: schemas = []} = useQuery(schemasQuery)
  const p = memberPreview(of, schemas) ?? {}
  const titleSpec = itemTitleSpec(of, p)
  const refs = itemRefs(item, of, schemas)
  const primed = useContext(PrimedContext)
  const targets = useQueries({queries: refs.map((r) => ({...docQuery(r.types, r.id ?? ''), enabled: !!r.id && r.types.length > 0 && primed(r.id)}))})
  const read = (path: string) => {
    const [head, ...rest] = path.split('.')
    const r = refs.findIndex((x) => x.name === head)
    if (r < 0) return rest.reduce<unknown>((v, k) => (v as Record<string, unknown> | null | undefined)?.[k], item[head!])
    const target = targets[r]?.data
    if (!rest.length) return target ? previewTitle(target, schemaOf(schemas, target._type), t) : undefined
    return rest.reduce<unknown>((v, k) => (v as Record<string, unknown> | null | undefined)?.[k], target)
  }
  const typeTitle = (type: string) => schemaOf(schemas, type)?.title
  // An array of images: titled by the picture's file name, as Sanity's.
  const picture = of.type === 'image' ? imageRef(item as ImageValue) : undefined
  const {data: asset} = useQuery({
    queryKey: ['media-info', picture],
    enabled: !!picture,
    staleTime: Infinity,
    queryFn: () => fetch(`/api/media/${encodeURIComponent(picture!.replace(/^asset-/, ''))}/info`).then((r) => (r.ok ? (r.json() as Promise<{name?: string}>) : null)),
  })
  return {
    title: (of.type === 'image' ? asset?.name : formatPreview(titleSpec, read, {typeTitle})) || (named ? memberChoices([of], schemas)[0]!.title : '') || translate(locale, 'Untitled'),
    subtitle: formatPreview(p.subtitle, read, {typeTitle}),
    // An array of images: each item is its own picture.
    media: (of.type === 'image' && imageRef(item) ? item : firstMedia(p.media, read, (v) => !!imageRef(v))) as ImageValue | undefined,
  }
}

function ItemRow({item, of, named, onOpen}: {item: Item; of: Field; named?: boolean; onOpen: () => void}) {
  const {title, subtitle, media} = useItemPreview(item, of, named)
  const {data: schemas = []} = useQuery(schemasQuery)
  // No media: the member's type icon, as Sanity's (a named object type carries one).
  const icon = <TypeIcon schema={of.namedType ? schemaOf(schemas, of.namedType) : undefined} />
  const t = useT()
  const up = useContext(UploadsContext).get(item._key ?? '')
  if (up) {
    const percent = Math.round(up.progress * 100)
    return (
      <div className="array-item-preview array-item-uploading" role="status" aria-label={t('Uploading {name}', {name: up.name})}>
        <span className="media has-image">
          <img src={up.preview} alt="" decoding="async" />
        </span>
        <span className="text">
          <span className="title">{up.name}</span>
          <span className="upload-progress-bar" role="progressbar" aria-label={t('Uploading')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <span style={{width: `${percent}%`}} />
          </span>
        </span>
        <button type="button" className="btn upload-cancel" onClick={up.cancel}>
          {t('Cancel')}
        </button>
      </div>
    )
  }
  return (
    <button type="button" className="array-item-preview" onClick={onOpen}>
      <span className={media ? 'media has-image' : 'media'}>{media ? <Thumb value={media} fallback={icon} /> : icon}</span>
      <span className="text">
        <span className="title">{title}</span>
        {subtitle && <span className="subtitle">{subtitle}</span>}
      </span>
    </button>
  )
}

function ItemDialog({parentTitle, position, item, of, named, path, readOnly, openRef, onChange, onClose}: {
  parentTitle: string
  position: number
  item: Item
  of: Field
  named?: boolean
  path: string
  readOnly?: boolean
  openRef: OpenRef
  onChange: (item: Item) => void
  onClose: () => void
}) {
  const t = useT()
  const {title} = useItemPreview(item, of, named)
  // An array inside an item: its dialog names the whole way down, as Sanity's
  // ("Sections / #1 Intro / Items / #2 …"); a crumb before ours closes back to it.
  const outer = useContext(DialogCrumbsContext)
  const here: Crumb = {label: parentTitle, position, title, close: onClose}
  // Over the whole document pane, as the other dialogs (not over the field's box).
  return (
    <DialogCrumbsContext.Provider value={[...outer, here]}>
    <PaneOverlay>
    <div className="dialog-backdrop item-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog item-dialog" aria-modal="true" aria-label={`${parentTitle} / ${title}`} onClose={onClose}>
        <header>
          <nav className="crumbs" aria-label={t('Breadcrumb')}>
            {outer.map((c, i) => (
              <Fragment key={i}>
                <button type="button" className="crumb" onClick={c.close}>
                  {c.label}
                </button>
                <span aria-hidden>/</span>
                <button type="button" className="crumb" onClick={outer[i + 1]?.close ?? onClose}>
                  <span className="muted">#{c.position}</span> <span className="crumb-title">{c.title}</span>
                </button>
                <span aria-hidden>/</span>
              </Fragment>
            ))}
            <button type="button" className="crumb" onClick={onClose}>
              {parentTitle}
            </button>
            <span aria-hidden>/</span>
            <span className="crumb current">
              <span className="muted">#{position}</span> <span className="crumb-title">{title}</span>
            </span>
          </nav>
          <button type="button" className="icon-btn" aria-label={t('Close dialog')} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className={of.type === 'image' ? 'dialog-body item-fields image-item' : 'dialog-body item-fields'}>
          <fieldset className="form-fields" disabled={readOnly}>
            <ParentContext.Provider value={item}>
              {of.type === 'image' ? (
                // An array of images: the item is the image (upload, select, hotspot and crop, its fields).
                <FieldView field={{...of, name: 'image', title: t('Image')}} path={path} value={item} openRef={openRef} onChange={(v) => onChange({...((v as Item | undefined) ?? {}), _type: named ? memberName(of) : 'image', _key: item._key})} />
              ) : (
                fieldsOf(of, item).map((f) => (
                  <FieldView key={f.name} field={f} path={`${path}.${f.name}`} value={item[f.name]} openRef={openRef} onChange={(v) => onChange({...item, [f.name]: v})} />
                ))
              )}
            </ParentContext.Provider>
          </fieldset>
        </div>
      </DialogBox>
    </div>
    </PaneOverlay>
    </DialogCrumbsContext.Provider>
  )
}
