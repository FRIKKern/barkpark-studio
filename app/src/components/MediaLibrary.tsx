import {useEffect, useState, type FormEvent} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {assetQuery, assetsQuery, collectionsQuery, createFolder, saveAssetMeta, setCheckout, setMember, type LibraryAsset, type Visibility} from '../lib/media-library'
import {reasonOf} from '../lib/edits'
import {Close, DocumentIcon, Search} from './icons'
import {toast} from './Toasts'
import {useT, type T} from '../lib/i18n'

// B08: the Media tool, after Barkpark's LiveView media library: folders, a visibility
// filter, and the checkout lock on an asset's edits. Laid out like Sanity's media
// browser: folders left, tiles in the middle, the picked asset's inspector right.

const size = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`)
const fail = (title: string) => (e: unknown) => toast({tone: 'critical', title, description: reasonOf((e as Error).message) ?? (e as Error).message})

export function MediaLibrary() {
  const t = useT()
  const qc = useQueryClient()
  const [folder, setFolder] = useState<string>()
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [visibility, setVisibility] = useState<Visibility | ''>('')
  const [picked, setPicked] = useState<string>()
  useEffect(() => {
    const timer = setTimeout(() => setQuery(q.trim()), 200)
    return () => clearTimeout(timer)
  }, [q])
  const folders = useQuery(collectionsQuery)
  const filter = {collection: folder, q: query || undefined, visibility: visibility || undefined}
  const assets = useQuery(assetsQuery(filter))
  const [naming, setNaming] = useState<string | null>(null)
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
  const folderTitle = folders.data?.find((f) => f.id === folder)?.title
  return (
    <main className="media-tool">
      <nav className="media-folders" aria-label={t('Folders')}>
        <h1>{t('Media')}</h1>
        <button type="button" className="type-row" aria-current={!folder} onClick={() => setFolder(undefined)}>
          {t('All media')}
        </button>
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
          <button type="button" className="btn-text media-new-folder" onClick={() => setNaming('')}>
            + {t('New folder')}
          </button>
        ) : (
          <form onSubmit={newFolder} className="media-new-folder">
            <input className="input" aria-label={t('Folder name')} autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setNaming(null)} />
            <button type="submit" className="btn">{t('Create')}</button>
          </form>
        )}
      </nav>
      <section className="media-browse" aria-label={folderTitle ?? t('All media')}>
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
        </header>
        {assets.isPending && <p className="list-empty" role="status">{t('Loading media…')}</p>}
        {assets.isError && (
          <div className="list-search-error" role="alert">
            <p>{t('Could not load the media library.')}</p>
            <button type="button" className="btn" onClick={() => void assets.refetch()}>{t('Retry')}</button>
          </div>
        )}
        {assets.data?.assets.length === 0 && <p className="list-empty" role="status">{query || visibility ? t('No matching media') : folder ? t('This folder is empty') : t('No media yet')}</p>}
        <ul className="media-grid">
          {assets.data?.assets.map((a) => (
            <li key={a.id}>
              <Tile asset={a} picked={picked === a.id} onPick={() => setPicked(a.id)} />
            </li>
          ))}
        </ul>
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
        <dd>{a.visibilityNotice?.label ?? a.visibility ?? t('unknown')}</dd>
      </dl>
      {a.visibilityNotice && <p className="muted media-note">{a.visibilityNotice.copy}</p>}
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
