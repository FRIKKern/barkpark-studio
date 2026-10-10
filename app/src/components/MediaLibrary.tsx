import {useEffect, useRef, useState, type FormEvent} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {assetQuery, assetsQuery, collectionsQuery, createFolder, KINDS, kindCountsQuery, saveAssetMeta, SORTS, type Sort, setCheckout, setMember, type Kind, type LibraryAsset, type Visibility} from '../lib/media-library'
import {reasonOf} from '../lib/edits'
import {Close, DocumentIcon, Search} from './icons'
import {toast} from './Toasts'
import {useT, type T} from '../lib/i18n'
import {useCanWrite} from '../lib/session'
import {uploadFile} from '../lib/upload'

// B08: the Media tool, after Barkpark's LiveView media library: folders, a visibility
// filter, and the checkout lock on an asset's edits. Laid out like Sanity's media
// browser: folders left, tiles in the middle, the picked asset's inspector right.

const SORT_TITLES: Record<Sort, string> = {'created-desc': 'Newest first', 'created-asc': 'Oldest first', 'updated-desc': 'Recently updated'}
const KIND_TITLES: Record<Kind, string> = {image: 'Images', video: 'Video', audio: 'Audio', document: 'Documents', other: 'Other'}
/** One asset's kind, as LiveView's list and inspector name it. */
const KIND_NAMES: Record<Kind, string> = {image: 'image', video: 'video', audio: 'audio', document: 'document', other: 'other'}
const size = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`)
const fail = (title: string) => (e: unknown) => toast({tone: 'critical', title, description: reasonOf((e as Error).message) ?? (e as Error).message})

export function MediaLibrary() {
  const t = useT()
  const qc = useQueryClient()
  // One place picked on the left, as LiveView's: the whole library, a kind, or a folder.
  const [folder, setFolderOnly] = useState<string>()
  const [kind, setKindOnly] = useState<Kind>()
  const setFolder = (f: string | undefined) => (setFolderOnly(f), setKindOnly(undefined))
  const setKind = (k: Kind | undefined) => (setKindOnly(k), setFolderOnly(undefined))
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [visibility, setVisibility] = useState<Visibility | ''>('')
  const [sort, setSort] = useState<Sort>('created-desc')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [picked, setPicked] = useState<string>()
  useEffect(() => {
    const timer = setTimeout(() => setQuery(q.trim()), 200)
    return () => clearTimeout(timer)
  }, [q])
  const folders = useQuery(collectionsQuery)
  const filter = {collection: folder, kind, q: query || undefined, visibility: visibility || undefined, sort}
  const assets = useQuery(assetsQuery(filter))
  const counts = useQuery(kindCountsQuery({q: filter.q, visibility: filter.visibility})).data
  const [naming, setNaming] = useState<string | null>(null)
  const {canWrite, createReason} = useCanWrite()
  const newFolder = async (e: FormEvent) => {
    e.preventDefault()
    const title = naming?.trim()
    if (!title) return setNaming(null)
    try {
      const id = await createFolder({data: {title}})
      setNaming(null)
      await qc.invalidateQueries({queryKey: ['media', 'collections']})
      setFolder(id)
    } catch (err) {
      fail(t('Could not create the folder'))(err)
    }
  }
  // Upload (LiveView's Upload button): each file in turn, into the library.
  const picker = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState<{done: number; of: number} | null>(null)
  const upload = async (files: File[]) => {
    if (!files.length) return
    let done = 0
    setUploading({done, of: files.length})
    for (const file of files) {
      try {
        await uploadFile(file, () => {}, new AbortController().signal)
      } catch (err) {
        fail(t('Could not upload {name}', {name: file.name}))(err)
      }
      setUploading({done: ++done, of: files.length})
    }
    setUploading(null)
    await qc.invalidateQueries({queryKey: ['media', 'assets']})
  }
  const folderTitle = folders.data?.find((f) => f.id === folder)?.title
  const shown = assets.data?.assets.length ?? 0
  const total = assets.data?.total ?? null
  return (
    <main className="media-tool">
      <nav className="media-folders" aria-label={t('Folders')}>
        <h1>{t('Media')}</h1>
        <button type="button" className="type-row" aria-current={!folder && !kind} onClick={() => setFolder(undefined)}>
          {t('All media')}
          {counts && <span className="media-kind-count">{counts.total}</span>}
        </button>
        {KINDS.map((k) => (
          <button key={k} type="button" className="type-row media-kind" aria-current={kind === k} onClick={() => setKind(k)}>
            {t(KIND_TITLES[k])}
            {counts && <span className="media-kind-count">{counts.kinds[k] ?? 0}</span>}
          </button>
        ))}
        <div className="desk-divider">{t('Folders')}</div>
        {folders.isError && (
          <p className="muted" role="alert">
            {t('Could not load folders.')} <button type="button" className="btn-text" onClick={() => void folders.refetch()}>{t('Retry')}</button>
          </p>
        )}
        {folders.data?.length === 0 && <p className="muted media-empty-note">{t('No folders yet.')}</p>}
        {folders.data?.map((f) => (
          <button key={f.id} type="button" className="type-row" aria-current={folder === f.id} onClick={() => setFolder(f.id)}>
            {f.title}
          </button>
        ))}
        {naming === null ? (
          <button type="button" className="btn-text media-new-folder" disabled={!canWrite} title={createReason} onClick={() => setNaming('')}>
            + {t('New folder')}
          </button>
        ) : (
          <form onSubmit={newFolder} className="media-new-folder">
            <input className="input" aria-label={t('Folder name')} autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setNaming(null)} />
            <button type="submit" className="btn">{t('Create')}</button>
          </form>
        )}
      </nav>
      <section className="media-browse" aria-label={folderTitle ?? (kind ? t(KIND_TITLES[kind]) : t('All media'))}>
        <header className="media-bar">
          <div className="search">
            <span className="search-icon"><Search /></span>
            <input type="search" aria-label={t('Search media')} placeholder={t('Search media')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input media-visibility" aria-label={t('Visibility')} value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility | '')}>
            <option value="">{t('Any visibility')}</option>
            <option value="public">{t('Public')}</option>
            <option value="private">{t('Private')}</option>
          </select>
          <div className="media-views" role="group" aria-label={t('Result view')}>
            <button type="button" className="btn" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>{t('Grid')}</button>
            <button type="button" className="btn" aria-pressed={view === 'list'} onClick={() => setView('list')}>{t('List')}</button>
          </div>
          <select className="input media-sort" aria-label={t('Sort')} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            {SORTS.map((o) => (
              <option key={o} value={o}>{t(SORT_TITLES[o])}</option>
            ))}
          </select>
          <input ref={picker} type="file" multiple hidden onChange={(e) => (void upload([...(e.target.files ?? [])]), (e.target.value = ''))} />
          <button type="button" className="publish media-upload" disabled={!canWrite || !!uploading} title={createReason} onClick={() => picker.current?.click()}>
            {uploading ? t('Uploading {done} of {of}…', uploading) : t('Upload')}
          </button>
        </header>
        {assets.data && shown > 0 && (
          <p className="media-count muted" role="status">
            {total !== null && total > shown ? t('Showing {shown} of {total} assets', {shown, total}) : (total ?? shown) === 1 ? t('1 asset') : t('{total} assets', {total: total ?? shown})}
          </p>
        )}
        {assets.isPending && <p className="list-empty" role="status">{t('Loading media…')}</p>}
        {assets.isError && (
          <div className="list-search-error" role="alert">
            <p>{t('Could not load the media library.')}</p>
            <button type="button" className="btn" onClick={() => void assets.refetch()}>{t('Retry')}</button>
          </div>
        )}
        {assets.data?.assets.length === 0 && <p className="list-empty" role="status">{query || visibility || kind ? t('No matching media') : folder ? t('This folder is empty') : t('No media yet')}</p>}
        {view === 'grid' ? (
          <ul className="media-grid">
            {assets.data?.assets.map((a) => (
              <li key={a.id}>
                <Tile asset={a} picked={picked === a.id} onPick={() => setPicked(a.id)} />
              </li>
            ))}
          </ul>
        ) : (
          // LiveView's list: name (with its thumbnail), kind, format, size.
          !!assets.data?.assets.length && (
            <table className="media-list">
              <thead>
                <tr>
                  <th scope="col">{t('Name')}</th>
                  <th scope="col">{t('Kind')}</th>
                  <th scope="col">{t('Format')}</th>
                  <th scope="col" className="num">{t('Size')}</th>
                </tr>
              </thead>
              <tbody>
                {assets.data.assets.map((a) => (
                  <tr key={a.id} aria-selected={picked === a.id}>
                    <td>
                      <button type="button" className="media-row" aria-pressed={picked === a.id} onClick={() => setPicked(a.id)}>
                        <span className="media-thumb">{a.mimeType.startsWith('image/') ? <img src={`/api/media/${encodeURIComponent(a.id)}?size=thumb`} alt="" loading="lazy" /> : <DocumentIcon />}</span>
                        <span className="media-name">{a.name}</span>
                      </button>
                    </td>
                    <td>{a.kind ? t(KIND_NAMES[a.kind as Kind] ?? a.kind) : ''}</td>
                    <td className="mono">{a.mimeType}</td>
                    <td className="num">{size(a.size)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </section>
      {picked && <Inspector id={picked} folder={folder} folders={folders.data ?? []} onClose={() => setPicked(undefined)} />}
    </main>
  )
}

function Tile({asset, picked, onPick}: {asset: LibraryAsset; picked: boolean; onPick: () => void}) {
  const t = useT()
  return (
    <button type="button" className="media-tile" aria-pressed={picked} onClick={onPick} title={asset.name}>
      <span className="media-thumb">{asset.mimeType.startsWith('image/') ? <img src={`/api/media/${encodeURIComponent(asset.id)}?size=thumb`} alt="" loading="lazy" /> : <DocumentIcon />}</span>
      <span className="media-name">{asset.name}</span>
      <span className="media-size muted">{size(asset.size)}</span>
      <span className="media-badges">
        {asset.checkedOutBy && <span className="badge" title={checkedOutBy(t, asset.checkedOutBy)}>{t('Locked')}</span>}
        {asset.visibility === 'private' && <span className="badge">{t('Private')}</span>}
      </span>
    </button>
  )
}

function Inspector({id, folder, folders, onClose}: {id: string; folder?: string; folders: {id: string; title: string}[]; onClose: () => void}) {
  const t = useT()
  const qc = useQueryClient()
  const {data: a, isError, refetch} = useQuery(assetQuery(id))
  const [meta, setMeta] = useState({title: '', altText: ''})
  const [busy, setBusy] = useState(false)
  useEffect(() => setMeta({title: a?.title ?? '', altText: a?.altText ?? ''}), [a?.id, a?.title, a?.altText])
  const refresh = () => Promise.all([qc.invalidateQueries({queryKey: ['media', 'asset', id]}), qc.invalidateQueries({queryKey: ['media', 'assets']})])
  /** Run a write, refresh, and say whether it worked (a refusal is shown, never a success). */
  const act = (title: string, run: () => Promise<unknown>) => async () => {
    setBusy(true)
    try {
      await run()
      await refresh()
      return true
    } catch (e) {
      fail(title)(e)
      return false
    } finally {
      setBusy(false)
    }
  }
  if (isError)
    return (
      <aside className="inspector media-inspector" aria-label={t('Asset')} role="alert">
        {t('Could not load this asset.')} <button type="button" className="btn-text" onClick={() => void refetch()}>{t('Retry')}</button>
      </aside>
    )
  if (!a) return <aside className="inspector media-inspector" aria-label={t('Asset')} aria-busy="true" />
  // The lock (LiveView's checkout): held by someone else, the metadata waits for them.
  const heldByOther = !!a.checkoutLabel && a.checkoutLabel !== 'you'
  const editReason = !a.canEdit ? t('You may not edit this asset') : heldByOther ? checkedOutBy(t, a.checkoutLabel!) : undefined
  const dirty = meta.title !== (a.title ?? '') || meta.altText !== (a.altText ?? '')
  return (
    <aside className="inspector media-inspector" aria-label={t('Asset')}>
      <header>
        <h2>{a.name}</h2>
        <button type="button" className="icon-btn" aria-label={t('Close asset')} onClick={onClose}>
          <Close />
        </button>
      </header>
      {a.mimeType.startsWith('image/') && <img className="media-preview" src={`/api/media/${encodeURIComponent(a.id)}`} alt={a.altText ?? ''} />}
      <dl className="paper-facts">
        <dt>{t('Type')}</dt>
        <dd>{a.mimeType || t('unknown')}</dd>
        <dt>{t('Size')}</dt>
        <dd>{size(a.size)}</dd>
        <dt>{t('Visibility')}</dt>
        {/* Barkpark sends its visibility copy in English; the Studio says it in the editor's language. */}
        <dd>{a.visibilityNotice ? t(a.visibilityNotice.label) : a.visibility ? t(a.visibility === 'private' ? 'Private' : 'Public') : t('unknown')}</dd>
      </dl>
      {a.visibilityNotice && <p className="muted media-note">{t(a.visibilityNotice.copy)}</p>}
      <section className="media-section" aria-label={t('Checkout')}>
        <h3>{t('Checkout')}</h3>
        <p role="status">{a.checkoutLabel ? checkedOutBy(t, a.checkoutLabel) : t('Not checked out. Check it out to keep others from editing it while you do.')}</p>
        {a.checkoutLabel === 'you' ? (
          <button type="button" className="btn" disabled={busy} onClick={act(t('Could not release the asset'), () => setCheckout({data: {id, out: false}}))}>{t('Release')}</button>
        ) : (
          <button type="button" className="btn" disabled={busy || heldByOther || !a.canEdit} title={editReason} onClick={act(t('Could not check out the asset'), () => setCheckout({data: {id, out: true}}))}>{t('Check out')}</button>
        )}
      </section>
      <form
        className="media-section"
        aria-label={t('Details')}
        onSubmit={(e) => {
          e.preventDefault()
          void act(t('Could not save the details'), () => saveAssetMeta({data: {id, set: meta}}))()
        }}
      >
        <h3>{t('Details')}</h3>
        <label className="paper-label" htmlFor="media-title">{t('Title')}</label>
        <input id="media-title" className="input" value={meta.title} readOnly={!!editReason} title={editReason} onChange={(e) => setMeta({...meta, title: e.target.value})} />
        <label className="paper-label" htmlFor="media-alt">{t('Alt text')}</label>
        <input id="media-alt" className="input" value={meta.altText} readOnly={!!editReason} title={editReason} onChange={(e) => setMeta({...meta, altText: e.target.value})} />
        {editReason && <p className="paper-fb" data-tone="warn">{editReason}</p>}
        <button type="submit" className="btn" disabled={busy || !!editReason || !dirty}>{t('Save')}</button>
      </form>
      <section className="media-section" aria-label={t('Folders')}>
        <h3>{t('Folders')}</h3>
        {folder ? (
          <button type="button" className="btn" disabled={busy} onClick={act(t('Could not remove it from the folder'), () => setMember({data: {collection: folder, asset: id, member: false}}))}>
            {t('Remove from this folder')}
          </button>
        ) : folders.length ? (
          <select
            className="input"
            aria-label={t('Add to folder')}
            value=""
            disabled={busy}
            onChange={(e) => e.target.value && void act(t('Could not add it to the folder'), () => setMember({data: {collection: e.target.value, asset: id, member: true}}))().then((ok) => ok && toast({title: t('Added to the folder')}))}
          >
            <option value="">{t('Add to folder…')}</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.title}</option>
            ))}
          </select>
        ) : (
          <p className="muted">{t('Create a folder to file it.')}</p>
        )}
      </section>
    </aside>
  )
}

/** "Checked out by Ada"; Barkpark names the reader's own checkout "you". */
const checkedOutBy = (t: T, who: string) => t('Checked out by {who}', {who: who === 'you' ? t('you') : who})
