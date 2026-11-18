import {createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type DragEvent} from 'react'
import {DialogBox, PaneOverlay} from './FocusScopes'
import {useQueries, useQuery, useQueryClient} from '@tanstack/react-query'
import {anyDocQuery, cachedDoc, docQuery, previewTitle, refId, refTypesOf, schemaOf, schemasQuery, type Field, type Schema} from '../lib/data'
import {firstMedia, formatPreview, mediaRefs, previewRefs, readPath, textRefs, type PreviewText} from '../lib/preview'
import {imageRef, pickedImage, type ImageValue} from '../lib/image'
import {uploadFile, UploadError} from '../lib/upload'
import {uploadMeta} from '../lib/image-meta'
import {toast} from './Toasts'
import {Thumb, TypeIcon} from './Preview'
import {copyItem, signature} from '../lib/clipboard'
import {EditPathContext, FieldView, FormDisabledContext, UrlPathContext, WriteUrlPathContext, type OpenRef, ParentContext} from './Fields'
import {SortableRows} from './SortableRows'
import {Close as CloseIcon, PanelLeftIcon, Upload} from './icons'
import {translate, useLocale, useT, useWorkspaceZone} from '../lib/i18n'
import {usePrimed} from '../lib/prime'
import {withField} from '../lib/with-field'
import {codeOptions, codePreview, isCodeField} from '../lib/code-input'
import {isTableField, tablePreview} from '../lib/table-input'
import {memberChoices, memberFor, memberName, memberPreview, membersOf, newMemberItem, referenceHeads} from '../lib/array-members'
import {ArrayTree, isNested, JumpContext, live, newJump, TreeRootContext, useSidebar, useTreeNodes, type Jump, type TreeRoot} from './ArrayTree'
import type {Titles} from '../lib/array-tree'
import {actions, modalOf, type Modal} from '../lib/array-options'
import {MAX_REACHED, maxItems, room} from '../lib/array-max'
import {dialogWidth, ItemPopover} from './ItemPopover'

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
  // Each member's type icon, for the insert menu's list and grid (Sanity's).
  const choices = multi ? memberChoices(members, schemas).map((c, i) => ({...c, icon: members[i]!.namedType ? schemaOf(schemas, members[i]!.namedType!) : undefined})) : typing?.types
  const deref = cachedDoc(useQueryClient())
  const primed = usePrimed(
    items.flatMap((it) => [
      ...itemRefs(it, memberOf(it), schemas).flatMap((r) => (r.id && r.types.length ? [{types: r.types, id: r.id}] : [])),
      ...deepRefs(it, memberOf(it), schemas, deref).map((id) => ({types: null, id})),
    ]),
  )
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
  // The nested item dialog's tree (ArrayTree): the outermost array of objects holds it, and the
  // jumps picked in it, which every array on the way follows.
  const parentRoot = useContext(TreeRootContext)
  const parentJump = useContext(JumpContext)
  const [ownJump, setOwnJump] = useState<Jump | null>(null)
  const jump = parentRoot ? parentJump : ownJump
  const titles = useTreeTitles()
  const root = useMemo<TreeRoot | null>(
    () => (parentRoot ? null : {id, label: field.title ?? field.name, field, items, title: titles, jump: (path) => setOwnJump(newJump(path))}),
    [parentRoot, id, field, items, titles],
  )
  // A jump in the tree: the array whose item is on the way opens it (naming it in the URL);
  // one with an item open off the way closes it. The array holding the picked item ends it.
  useEffect(() => {
    if (!live(jump)) return
    const own = `${id}[_key=="`
    if (!jump.target.startsWith(own)) return void (editing && close())
    const key = jump.target.slice(own.length).split('"]')[0]!
    if (!items.some((it) => it._key === key)) return
    const here = jump.target === `${own}${key}"]`
    if (editing !== key) open(key)
    else if (here) writePath?.(jump.target)
    if (here) jump.done.current = true
    // On a new jump, and when this array is another item's (its dialog now shows the next item).
  }, [jump, id])
  const set = (next: Item[]) => onChange(next)
  const modal = modalOf(field.options)
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
    // A drop takes only the files that fit; at the max it takes none and says why (Add item is off too).
    // The target stays at the max, so the browser never opens a dropped file in place of the studio.
    !multi && of.type === 'image' && !readOnly && actions(field.options).add
      ? {
          onDragEnter: (e: DragEvent<HTMLElement>) => carriesFiles(e) && (e.preventDefault(), setOver(room(field, latest.current) > 0)),
          onDragOver: (e: DragEvent<HTMLElement>) => carriesFiles(e) && e.preventDefault(),
          onDragLeave: (e: DragEvent<HTMLElement>) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(false),
          onDrop: (e: DragEvent<HTMLElement>) => {
            if (!carriesFiles(e)) return
            e.preventDefault()
            setOver(false)
            const files = imageFiles(e.dataTransfer.files)
            const fit = files.slice(0, room(field, latest.current))
            if (fit.length < files.length) toast({tone: 'caution', title: t(MAX_REACHED)})
            if (fit.length) dropImages(fit)
          },
        }
      : {}
  // Steady, so a row re-renders only when its own item changes (J44: 300 rows).
  const renderItem = useCallback((it: Item) => <ItemRow item={it} of={memberOf(it)} named={multi} onOpen={() => open(it._key ?? null)} />, [memberOf, multi, open])
  const out = (
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
        options={field.options}
        max={maxItems(field.validation)}
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
        {/* Sanity's options.modal: a popover by the item's row, or the dialog (ItemPopover.tsx). */}
        {modal.type === 'popover' ? (
          <ItemPopover key={editing} arrayId={id} itemKey={editing!} typeTitle={memberChoices([memberOf(items[index]!)], schemas)[0]!.title} readOnly={readOnly} width={modal.width} onClose={close}>
            <ItemFields item={items[index]!} of={memberOf(items[index]!)} named={multi} path={`${id}[_key=="${items[index]!._key}"]`} readOnly={readOnly} openRef={openRef} onChange={(next) => set(items.map((it, i) => (i === index ? next : it)))} />
          </ItemPopover>
        ) : (
        <ItemDialog
          parentTitle={field.title ?? field.name}
          position={index + 1}
          item={items[index]!}
          of={memberOf(items[index]!)}
          named={multi}
          path={`${id}[_key=="${items[index]!._key}"]`}
          readOnly={readOnly}
          openRef={openRef}
          width={modal.width}
          onChange={(next) => set(items.map((it, i) => (i === index ? next : it)))}
          onClose={close}
        />
        )}
        </OpenedByHandContext.Provider>
      )}
      </div>
    </UploadsContext.Provider>
    </PrimedContext.Provider>
  )
  return root ? (
    <TreeRootContext.Provider value={root}>
      <JumpContext.Provider value={ownJump}>{out}</JumpContext.Provider>
    </TreeRootContext.Provider>
  ) : (
    out
  )
}

/** The tree's item titles, as the rows' previews read them, from what is already loaded (no reads of their own). */
function useTreeTitles(): Titles {
  const {data: schemas = []} = useQuery(schemasQuery)
  const deref = cachedDoc(useQueryClient())
  const t = useT()
  const zone = useWorkspaceZone()
  return useCallback<Titles>(
    (item, of, named) => {
      const p = memberPreview(of, schemas) ?? {}
      const read = (path: string) => {
        const [head, ...rest] = path.split('.')
        if (of.fields?.find((f) => f.name === head)?.type !== 'reference') return readPath(item, path, deref)
        const target = deref(refId(item[head!]) ?? '') as Record<string, unknown> | undefined
        if (!target) return undefined
        return rest.length ? readPath(target, rest.join('.'), deref) : previewTitle(target as never, schemaOf(schemas, target._type as string), t)
      }
      const typeTitle = (type: string) => schemaOf(schemas, type)?.title
      return formatPreview(itemTitleSpec(of, p), read, {typeTitle, zone, deref}) || (named ? memberChoices([of], schemas)[0]!.title : '') || t('Untitled')
    },
    // `deref` reads the query cache: the same cache every render.
    [schemas, t, zone],
  )
}

/**
 * J33 (decision 0005): several item types in one Barkpark arrayOf (it takes one member shape until
 * task-b3ebbd3ab1575e2a). The member says which select names the type and which fields
 * each type has: `options: {typeField: "kind", fieldsByType: {externalLink: ["title", "url"]}}`.
 * Then adding asks the type (Sanity's insert menu) and an item shows its type's fields
 * only. Barkpark's LiveView ignores these options and shows the select and every field.
 */
type Typing = {field: string; types: {value: string; title: string; icon?: {icon: string; iconSvg?: string}}[]; fieldsByType: Record<string, string[]>}
function memberTypes(of: Field): Typing | undefined {
  const o = (Array.isArray(of.options) ? undefined : of.options) as {typeField?: string; fieldsByType?: Record<string, string[]>} | undefined
  const select = of.fields?.find((f) => f.name === o?.typeField)
  const list = select && Array.isArray(select.options) ? (select.options as {value: string; title?: string; icon?: string; iconSvg?: string}[]) : undefined
  if (!o?.typeField || !o.fieldsByType || !list) return undefined
  return {field: o.typeField, types: list.map((t) => ({value: t.value, title: t.title ?? t.value, ...(t.icon ? {icon: {icon: t.icon, iconSvg: t.iconSvg}} : {})})), fieldsByType: o.fieldsByType}
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

/**
 * The item's own reference fields its preview reads: the first segment of a dotted path when
 * that field is a reference ("linkedDocument.title"), and a bare reference field. A path
 * through a plain object or a list ("styling.theme", "tiles.0.image") is read in the item
 * (task-9eac3198549f501b).
 */
function itemRefs(item: Item, of: Field, schemas: Schema[]) {
  const p = memberPreview(of, schemas) ?? {}
  const specs = [itemTitleSpec(of, p), p.subtitle, p.media]
  const fieldOf = (name: string) => of.fields?.find((f) => f.name === name)
  const bare = specs.flatMap((s) => (typeof s === 'string' ? [s] : []))
  return referenceHeads(of, [...previewRefs(...specs), ...bare]).map((name) => ({name, id: refId(item[name]), types: refTypesOf(fieldOf(name))}))
}

/** The documents an item's preview reads deeper in (a reference inside an object or a list), read as the lists do. */
function deepRefs(item: Item, of: Field, schemas: Schema[], deref: (id: string) => unknown): string[] {
  const p = memberPreview(of, schemas) ?? {}
  const own = new Set(itemRefs(item, of, schemas).flatMap((r) => (r.id ? [r.id] : [])))
  const ids = [...textRefs(itemTitleSpec(of, p), item, deref), ...textRefs(p.subtitle, item, deref), ...mediaRefs(p.media, item, deref)]
  return [...new Set(ids)].filter((id) => !own.has(id))
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
  // Deeper references read through the same cache as the lists' rows (Preview.tsx).
  const deref = cachedDoc(useQueryClient())
  useQueries({queries: deepRefs(item, of, schemas, deref).map((id) => ({...anyDocQuery(id), enabled: primed(id)}))})
  const read = (path: string) => {
    const [head, ...rest] = path.split('.')
    const r = refs.findIndex((x) => x.name === head)
    if (r < 0) return readPath(item, path, deref)
    const target = targets[r]?.data
    if (!rest.length) return target ? previewTitle(target, schemaOf(schemas, target._type), t) : undefined
    return target ? readPath(target, rest.join('.'), deref) : undefined
  }
  const typeTitle = (type: string) => schemaOf(schemas, type)?.title
  const zone = useWorkspaceZone()
  // An array of images: titled by the picture's file name, as Sanity's.
  const picture = of.type === 'image' ? imageRef(item as ImageValue) : undefined
  const {data: asset} = useQuery({
    queryKey: ['media-info', picture],
    enabled: !!picture,
    staleTime: Infinity,
    queryFn: () => fetch(`/api/media/${encodeURIComponent(picture!.replace(/^asset-/, ''))}/info`).then((r) => (r.ok ? (r.json() as Promise<{name?: string}>) : null)),
  })
  // A code item (Sanity's code object): its first line, then its filename and language.
  // A table item (Sanity's table object): its first cells, then its size.
  const size = isTableField(of) ? tablePreview(item) : undefined
  const code = isCodeField(of) ? codePreview(item, codeOptions(of)) : size ? {title: size.text || translate(locale, 'Empty Table'), subtitle: size.rows ? translate(locale, '{rows} × {columns} table', {rows: size.rows, columns: size.columns}) : ''} : undefined
  return {
    title: (code ? code.title : of.type === 'image' ? asset?.name : formatPreview(titleSpec, read, {typeTitle, zone, deref})) || (named ? memberChoices([of], schemas)[0]!.title : '') || translate(locale, 'Untitled'),
    subtitle: code ? code.subtitle : formatPreview(p.subtitle, read, {typeTitle, zone, deref}),
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

type ItemProps = {item: Item; of: Field; named?: boolean; path: string; readOnly?: boolean; openRef: OpenRef; onChange: (item: Item) => void}

function ItemDialog({parentTitle, position, item, of, named, path, readOnly, openRef, width, onChange, onClose}: ItemProps & {parentTitle: string; position: number; width: Modal['width']; onClose: () => void}) {
  const t = useT()
  const {title} = useItemPreview(item, of, named)
  // An array inside an item: its dialog names the whole way down, as Sanity's
  // ("Sections / #1 Intro / Items / #2 …"); a crumb before ours closes back to it.
  const outer = useContext(DialogCrumbsContext)
  const here: Crumb = {label: parentTitle, position, title, close: onClose}
  // The sidebar tree of the outermost array (not for an image or a code item, whose dialog is one input).
  const root = useContext(TreeRootContext)
  const nodes = useTreeNodes(of.type === 'image' || isCodeField(of) ? null : root)
  const treeOn = !!root && (nodes.length > 1 || isNested(nodes))
  const side = useSidebar(isNested(nodes))
  const sideOpen = treeOn && side.open
  // Over the whole document pane, as the other dialogs (not over the field's box).
  return (
    <DialogCrumbsContext.Provider value={[...outer, here]}>
    <PaneOverlay>
    <div className="dialog-backdrop item-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog item-dialog" style={dialogWidth(width)} data-tree={sideOpen || undefined} aria-modal="true" aria-label={`${parentTitle} / ${title}`} onClose={onClose}>
        <span ref={side.measure} hidden />
        <header>
          {treeOn && (
            <button
              type="button"
              className="icon-btn item-tree-toggle"
              aria-label={sideOpen ? t('Close sidebar') : t('Open sidebar')}
              data-tip={sideOpen ? t('Close sidebar') : t('Open sidebar')}
              aria-expanded={sideOpen}
              aria-pressed={sideOpen}
              onClick={() => side.set(!sideOpen)}
            >
              <PanelLeftIcon />
            </button>
          )}
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
        <div className="item-dialog-main">
        {sideOpen && (
          <aside className="item-tree-side" data-narrow={side.narrow || undefined}>
            <ArrayTree root={root!} nodes={nodes} current={path} onPicked={side.narrow ? () => side.set(false) : undefined} />
          </aside>
        )}
        <div className={of.type === 'image' ? 'dialog-body item-fields image-item' : 'dialog-body item-fields'}>
          <ItemFields item={item} of={of} named={named} path={path} readOnly={readOnly} openRef={openRef} onChange={onChange} />
        </div>
        </div>
      </DialogBox>
    </div>
    </PaneOverlay>
    </DialogCrumbsContext.Provider>
  )
}

/** An item's fields, in its dialog or its popover. */
function ItemFields({item, of, named, path, readOnly, openRef, onChange}: ItemProps) {
  const t = useT()
  const formDisabled = useContext(FormDisabledContext)
  return (
    // The dialog is drawn outside the form's own disabled fieldset (PaneOverlay), so a read-only form (Published, a revision) locks it here.
    <fieldset className="form-fields" disabled={readOnly || formDisabled}>
      <ParentContext.Provider value={item}>
        {of.type === 'image' ? (
          // An array of images: the item is the image (upload, select, hotspot and crop, its fields).
          <FieldView field={{...of, name: 'image', title: t('Image')}} path={path} value={item} openRef={openRef} onChange={(v) => onChange({...((v as Item | undefined) ?? {}), _type: named ? memberName(of) : 'image', _key: item._key})} />
        ) : isCodeField(of) || isTableField(of) ? (
          // A code item is the code editor itself, not its four subfields; a table item its grid.
          <FieldView field={{...of, name: memberName(of), title: of.title ?? t(isTableField(of) ? 'Table' : 'Code')}} path={path} value={item} openRef={openRef} onChange={(v) => onChange({...((v as Item | undefined) ?? {}), _key: item._key})} />
        ) : (
          fieldsOf(of, item).map((f) => <FieldView key={f.name} field={f} path={`${path}.${f.name}`} value={item[f.name]} openRef={openRef} onChange={(v) => onChange(withField(item, f.name, v))} />)
        )}
      </ParentContext.Provider>
    </fieldset>
  )
}
