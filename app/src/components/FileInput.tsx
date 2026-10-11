import {Fragment, useState, type ClipboardEvent, type DragEvent} from 'react'
import {useInfiniteQuery, useQuery} from '@tanstack/react-query'
import {DialogBox, MenuPopover, PaneOverlay} from './FocusScopes'
import type {OpenRef} from './Fields'
import {toast} from './Toasts'
import {PaneLink} from './PaneLink'
import {BinaryDocumentIcon, Close as CloseIcon, Copy, DocumentIcon, Download, InfoOutline, Ellipsis, ErrorOutline, LinkIcon, Reset, Search as SearchIcon, Trash, Undo, Upload} from './icons'
import {AssetDeleteDialog} from './AssetDelete'
import type {Field} from '../lib/data'
import {assetUrl} from '../lib/image'
import {useLocale, useT} from '../lib/i18n'
import {accepts, ago, formatBytes, humanBytes, mayAccept, mimeTitle, type FileAsset} from '../lib/files'
import {uploadFile, UploadError} from '../lib/upload'
import {UploadProgress} from './UploadProgress'

// J54, after Sanity's file input: an empty box ("Drag or paste file here",
// Upload, Select); a file shows its name and size with an options menu (Upload,
// Select, Download, Copy URL, Clear field). `options.accept` limits what the
// file chooser, a drop, a paste and Select offer. A failed upload says so and
// offers Retry (as the image input). The value is Sanity's and Barkpark's canonical one
// (barkpark#22289): {_type: 'file', asset: {_type: 'reference', _ref: 'asset-<id>'}}.

type Props = {id: string; field: Field; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean; openRef: OpenRef}
type FileValue = {_type?: string; asset?: {_type?: string; _ref?: string}}

const filesOf = (list: FileList | DataTransferItemList | undefined | null): File[] =>
  Array.from((list ?? []) as ArrayLike<File | DataTransferItem>).flatMap((item) => {
    const f = item instanceof File ? item : item.kind === 'file' ? item.getAsFile() : null
    return f ? [f] : []
  })
const carriesFiles = (e: DragEvent<HTMLElement>) => [...e.dataTransfer.types].includes('Files')

export const useFileInfo = (ref: string | undefined) =>
  useQuery({
    queryKey: ['media-info', ref],
    enabled: !!ref,
    staleTime: Infinity,
    queryFn: () => fetch(`/api/media/${encodeURIComponent(ref!.replace(/^asset-/, ''))}/info`).then((r) => (r.ok ? (r.json() as Promise<FileAsset>) : Promise.reject(new Error(`file → ${r.status}`)))),
  })

export function FileInput({id, field, value, onChange, readOnly, openRef}: Props) {
  const file = (value && typeof value === 'object' ? value : {}) as FileValue
  const ref = file.asset?._ref
  const accept = (field.options as {accept?: string} | undefined)?.accept
  const info = useFileInfo(ref)
  const t = useT()
  const [uploading, setUploading] = useState<{name: string; progress: number; stop: AbortController} | null>(null)
  const [failed, setFailed] = useState<File | null>(null)
  const [over, setOver] = useState<'ok' | 'rejected' | null>(null)
  const [menu, setMenu] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [chooser, setChooser] = useState<HTMLInputElement | null>(null)
  const title = field.title ?? field.name
  const use = (next: string) => onChange({...file, _type: 'file', asset: {_type: 'reference', _ref: next}})

  // Progress as it goes; Cancel aborts it and the field keeps its value.
  const upload = async (f: File) => {
    const stop = new AbortController()
    setUploading({name: f.name, progress: 0, stop})
    setFailed(null)
    try {
      use(await uploadFile(f, (progress) => setUploading((u) => u && u.stop === stop ? {...u, progress} : u), stop.signal))
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setFailed(f)
      toast({tone: 'critical', title: t('Upload failed'), description: err instanceof UploadError && err.network ? t('The network is unreachable.') : t('The upload could not be completed at this time.')})
    } finally {
      setUploading((u) => (u?.stop === stop ? null : u))
    }
  }
  const take = (list: File[]) => {
    const ok = list.find((f) => accepts(accept, f))
    if (ok) void upload(ok)
    else if (list.length) toast({tone: 'critical', title: t("Can't upload this file here")})
    return !!ok
  }
  const target = readOnly
    ? {}
    : {
        onDragEnter: (e: DragEvent<HTMLElement>) =>
          carriesFiles(e) && (e.preventDefault(), setOver([...e.dataTransfer.items].some((i) => i.kind === 'file' && mayAccept(accept, i.type)) ? 'ok' : 'rejected')),
        onDragOver: (e: DragEvent<HTMLElement>) => carriesFiles(e) && e.preventDefault(),
        onDragLeave: (e: DragEvent<HTMLElement>) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(null),
        onDrop: (e: DragEvent<HTMLElement>) => (e.preventDefault(), setOver(null), take(filesOf(e.dataTransfer.files))),
        onPaste: (e: ClipboardEvent<HTMLElement>) => {
          const list = filesOf(e.clipboardData.files).length ? filesOf(e.clipboardData.files) : filesOf(e.clipboardData.items)
          if (list.length) (e.preventDefault(), take(list))
        },
      }
  const overlay = over && (
    <div className="drop-overlay" aria-live="polite" data-rejected={over === 'rejected' || undefined}>
      {over === 'rejected' ? (
        <>
          <ErrorOutline /> {t("Can't upload this file here")}
        </>
      ) : (
        <>
          <Upload /> {t('Drop to upload file')}
        </>
      )}
    </div>
  )
  const pick = () => chooser?.click()
  const url = ref ? assetUrl(ref) : undefined
  const name = info.data?.name

  return (
    <div className="file-input" id={id}>
      <input ref={setChooser} type="file" accept={accept} hidden onChange={(e) => (e.target.files?.[0] && upload(e.target.files[0]), (e.target.value = ''))} />
      {uploading ? (
        <UploadProgress name={uploading.name} progress={uploading.progress} onCancel={() => uploading.stop.abort()} />
      ) : !ref ? (
        // Focusable so a paste has somewhere to land.
        <div className="file-box empty" tabIndex={readOnly ? undefined : 0} aria-label={t('{title}: drop, paste or upload a file', {title})} {...target}>
          {overlay}
          {failed ? (
            <span className="hint failed" role="alert">
              <ErrorOutline /> {t('Upload failed')}
            </span>
          ) : (
            <span className="hint">
              <BinaryDocumentIcon /> {readOnly ? t('Read only') : t('Drag or paste file here')}
            </span>
          )}
          <span className="file-actions">
            {failed && (
              <button type="button" className="btn ghost" onClick={() => upload(failed)}>
                <Undo /> {t('Retry')}
              </button>
            )}
            <button type="button" className="btn ghost" disabled={readOnly} onClick={pick}>
              <Upload /> {t('Upload')}
            </button>
            <button type="button" className="btn ghost" disabled={readOnly} onClick={() => setBrowsing(true)}>
              <SearchIcon /> {t('Select')}
            </button>
          </span>
        </div>
      ) : (
        <div className="file-box" tabIndex={readOnly ? undefined : 0} aria-label={t('{title}: drop or paste a file to replace it', {title})} {...target}>
          {overlay}
          <span className="file-icon">
            <BinaryDocumentIcon />
          </span>
          <span className="file-text">
            {info.isError ? (
              <span className="file-name">{t('File unavailable')}</span>
            ) : (
              <>
                <span className="file-name">{name ?? '…'}</span>
                {info.data && <span className="file-size">{formatBytes(info.data.size)}</span>}
              </>
            )}
          </span>
          <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMenu(false)}>
            <button id={`${id}-menuButton`} type="button" className="icon-btn" aria-label={t('Open file options menu')} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              <Ellipsis />
            </button>
            {menu && (
              <MenuPopover className="popover menu image-menu file-menu" onClose={() => setMenu(false)} aria-labelledby={`${id}-menuButton`}>
                <button type="button" role="menuitem" className="menu-item" disabled={readOnly} onClick={() => (setMenu(false), pick())}>
                  <Upload /> {t('Upload')}
                </button>
                <hr />
                <button type="button" role="menuitem" className="menu-item" disabled={readOnly} onClick={() => (setMenu(false), setBrowsing(true))}>
                  <SearchIcon /> {t('Select')}
                </button>
                <a role="menuitem" className="menu-item" href={url} download={name ?? true} onClick={() => setMenu(false)}>
                  <Download /> {t('Download')}
                </a>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => (setMenu(false), navigator.clipboard.writeText(new URL(url!, location.href).href).then(() => toast({title: t('The URL is copied to the clipboard')})))}
                >
                  <Copy /> {t('Copy URL')}
                </button>
                <hr />
                <button type="button" role="menuitem" className="menu-item danger" disabled={readOnly} onClick={() => (setMenu(false), onChange(undefined))}>
                  <Reset /> {t('Clear field')}
                </button>
              </MenuPopover>
            )}
          </div>
        </div>
      )}
      {browsing && <FilePicker title={title} path={id} accept={accept} current={ref} openRef={openRef} onPick={(next) => (setBrowsing(false), use(next))} onClose={() => setBrowsing(false)} />}
    </div>
  )
}

/** Sanity's "Select file for <field>": the accepted files as a table; each row's "…" shows where it is used. */
function FilePicker({title, path, accept, current, openRef, onPick, onClose}: {title: string; path: string; accept?: string; current?: string; openRef: OpenRef; onPick: (ref: string) => void; onClose: () => void}) {
  // A page at a time with "Load more", fresh on each open: as the image picker (#389).
  const {data, isPending, error, fetchNextPage, hasNextPage, isFetchingNextPage} = useInfiniteQuery({
    queryKey: ['media-files', accept ?? ''],
    gcTime: 0,
    initialPageParam: 0,
    queryFn: ({pageParam}) =>
      fetch(`/api/media/files?offset=${pageParam}${accept ? `&accept=${encodeURIComponent(accept)}` : ''}`).then((r) =>
        r.ok ? (r.json() as Promise<{files: FileAsset[]; nextOffset: number | null}>) : Promise.reject(new Error(`files → ${r.status}`)),
      ),
    getNextPageParam: (last) => last.nextOffset ?? undefined,
  })
  const files = data?.pages.flatMap((p) => p.files)
  const t = useT()
  const locale = useLocale()
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [usageOf, setUsageOf] = useState<FileAsset | null>(null)
  const [deleting, setDeleting] = useState<FileAsset | null>(null)
  return (
    <PaneOverlay>
      <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <DialogBox className="dialog asset-dialog file-dialog" aria-modal="true" aria-labelledby={`${path}-files-title`} onClose={onClose}>
          <header>
            <h2 id={`${path}-files-title`}>{t('Select file for "{title}"', {title})}</h2>
            <button type="button" className="icon-btn" aria-label={t('Close dialog')} onClick={onClose}>
              <CloseIcon />
            </button>
          </header>
          <div className="dialog-body">
            {accept && (
              <p className="accept-note">
                <InfoOutline /> {t('Only showing assets of accepted types:')} <strong>{accept}</strong>
              </p>
            )}
            {isPending && <p className="muted">{t('Loading files…')}</p>}
            {error && <p role="alert">{t('Could not load the files: {message}', {message: (error as Error).message})}</p>}
            {files && (
              <table className="file-table">
                <thead>
                  <tr>
                    <th>{t('Filename')}</th>
                    <th>{t('Size')}</th>
                    <th>{t('Type')}</th>
                    <th>{t('Date added')}</th>
                    <th aria-label={t('Actions')} />
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => (
                    <Fragment key={f.id}>
                      <tr>
                        <td>
                          <button type="button" className="file-pick" onClick={() => onPick(`asset-${f.id}`)}>
                            <DocumentIcon /> {f.name}
                          </button>
                        </td>
                        <td>{humanBytes(f.size, locale)}</td>
                        <td>{t(mimeTitle(f.mimeType))}</td>
                        <td>{f.createdAt && ago(f.createdAt, Date.now(), locale)}</td>
                        <td>
                          <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMenuFor(null)}>
                            <button id={`file-${f.id}-menuButton`} type="button" className="icon-btn" aria-label={t('{name}: more', {name: f.name})} aria-haspopup="menu" aria-expanded={menuFor === f.id} onClick={() => setMenuFor(menuFor === f.id ? null : f.id)}>
                              <Ellipsis />
                            </button>
                            {menuFor === f.id && (
                              <MenuPopover className="popover menu image-menu" onClose={() => setMenuFor(null)} aria-labelledby={`file-${f.id}-menuButton`}>
                                <button type="button" role="menuitem" className="menu-item" onClick={() => (setMenuFor(null), setUsageOf(f))}>
                                  <LinkIcon /> {t('Show usage')}
                                </button>
                                {/* Sanity's: the file the field holds can't be deleted from here. */}
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="menu-item danger"
                                  aria-disabled={current === `asset-${f.id}` || undefined}
                                  title={current === `asset-${f.id}` ? t('Cannot delete currently selected file') : t('Delete file')}
                                  onClick={() => current !== `asset-${f.id}` && (setMenuFor(null), setDeleting(f))}
                                >
                                  <Trash /> {t('Delete')}
                                </button>
                              </MenuPopover>
                            )}
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
            {hasNextPage && (
              <button type="button" className="btn load-more" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
                {isFetchingNextPage ? t('Loading files…') : t('Load more')}
              </button>
            )}
          </div>
        </DialogBox>
        {usageOf && <FileUsage file={usageOf} path={path} openRef={openRef} onClose={() => setUsageOf(null)} onOpen={onClose} />}
        {deleting && <AssetDeleteDialog kind="file" asset={deleting} path={path} openRef={openRef} onClose={() => setDeleting(null)} onOpen={onClose} />}
      </div>
    </PaneOverlay>
  )
}

function FileUsage({file, path, openRef, onClose, onOpen}: {file: FileAsset; path: string; openRef: OpenRef; onClose: () => void; onOpen: () => void}) {
  const t = useT()
  const {data: uses, isPending} = useQuery({queryKey: ['media-usage', file.id], queryFn: () => fetch(`/api/media/${encodeURIComponent(file.id)}/usage`).then((r) => r.json() as Promise<{_id: string; _type: string; title?: string}[]>)})
  return (
    <div className="dialog-backdrop nested" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog usage-dialog" aria-modal="true" aria-label={t('Documents using file')} onClose={onClose}>
        <header>
          <h2>{t('Documents using file')}</h2>
          <button type="button" className="icon-btn" aria-label={t('Close dialog')} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="dialog-body">
          {isPending && <p className="muted">{t('Looking…')}</p>}
          {uses?.length === 0 && (
            <h3 className="usage-none">
              {t('No documents are using file')} <code>{file.name}</code>
            </h3>
          )}
          {!!uses?.length && (
            <ul className="usage-list">
              {uses.map((u) => (
                <li key={u._id} onClick={onOpen}>
                  <PaneLink href={openRef(u._type, u._id, path).href}>
                    <DocumentIcon /> {u.title || t('Untitled')} <span className="muted">{u._type}</span>
                  </PaneLink>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogBox>
    </div>
  )
}
