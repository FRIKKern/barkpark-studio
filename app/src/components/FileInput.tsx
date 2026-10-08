import {Fragment, useState, type ClipboardEvent, type DragEvent} from 'react'
import {useQuery} from '@tanstack/react-query'
import {DialogBox, MenuPopover, PaneOverlay} from './FocusScopes'
import type {OpenRef} from './Fields'
import {toast} from './Toasts'
import {PaneLink} from './PaneLink'
import {Close as CloseIcon, Copy, DocumentIcon, Download, InfoOutline, Ellipsis, ErrorOutline, LinkIcon, Reset, Search as SearchIcon, Undo, Upload} from './icons'
import type {Field} from '../lib/data'
import {assetUrl} from '../lib/image'
import {accepts, ago, formatBytes, humanBytes, mayAccept, mimeTitle, type FileAsset} from '../lib/files'

// J54, after Sanity's file input: an empty box ("Drag or paste file here",
// Upload, Select); a file shows its name and size with an options menu (Upload,
// Select, Download, Copy URL, Clear field). `options.accept` limits what the
// file chooser, a drop, a paste and Select offer. A failed upload says so and
// offers Retry (as the image input). The value is Sanity's: {_type: 'file', asset: {_ref}}.

type Props = {id: string; field: Field; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean; openRef: OpenRef}
type FileValue = {_type?: string; asset?: {_ref?: string}}

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
  const [uploading, setUploading] = useState<string | null>(null)
  const [failed, setFailed] = useState<File | null>(null)
  const [over, setOver] = useState<'ok' | 'rejected' | null>(null)
  const [menu, setMenu] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [chooser, setChooser] = useState<HTMLInputElement | null>(null)
  const title = field.title ?? field.name
  const use = (next: string) => onChange({...file, _type: 'file', asset: {_ref: next}})

  const upload = async (f: File) => {
    setUploading(f.name)
    setFailed(null)
    try {
      const body = new FormData()
      body.append('file', f)
      const res = await fetch('/api/media/upload', {method: 'POST', body})
      if (!res.ok) throw new Error(`The server answered ${res.status}.`)
      use(((await res.json()) as {ref: string}).ref)
    } catch (err) {
      setFailed(f)
      toast({tone: 'critical', title: 'Upload failed', description: err instanceof TypeError ? 'The network is unreachable.' : 'The upload could not be completed at this time.'})
    } finally {
      setUploading(null)
    }
  }
  const take = (list: File[]) => {
    const ok = list.find((f) => accepts(accept, f))
    if (ok) void upload(ok)
    else if (list.length) toast({tone: 'critical', title: "Can't upload this file here"})
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
          <ErrorOutline /> Can't upload this file here
        </>
      ) : (
        <>
          <Upload /> Drop to upload file
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
      {!ref || uploading ? (
        // Focusable so a paste has somewhere to land.
        <div className="file-box empty" tabIndex={readOnly ? undefined : 0} aria-label={`${title}: drop, paste or upload a file`} data-uploading={uploading ? '' : undefined} {...target}>
          {overlay}
          {uploading ? (
            <span className="hint" role="status">
              <DocumentIcon /> Uploading {uploading}…
            </span>
          ) : failed ? (
            <span className="hint failed" role="alert">
              <ErrorOutline /> Upload failed
            </span>
          ) : (
            <span className="hint">
              <DocumentIcon /> {readOnly ? 'Read only' : 'Drag or paste file here'}
            </span>
          )}
          {!uploading && (
            <span className="file-actions">
              {failed && (
                <button type="button" className="btn ghost" onClick={() => upload(failed)}>
                  <Undo /> Retry
                </button>
              )}
              <button type="button" className="btn ghost" disabled={readOnly} onClick={pick}>
                <Upload /> Upload
              </button>
              <button type="button" className="btn ghost" disabled={readOnly} onClick={() => setBrowsing(true)}>
                <SearchIcon /> Select
              </button>
            </span>
          )}
        </div>
      ) : (
        <div className="file-box" tabIndex={readOnly ? undefined : 0} aria-label={`${title}: drop or paste a file to replace it`} {...target}>
          {overlay}
          <span className="file-icon">
            <DocumentIcon />
          </span>
          <span className="file-text">
            {info.isError ? (
              <span className="file-name">File unavailable</span>
            ) : (
              <>
                <span className="file-name">{name ?? '…'}</span>
                {info.data && <span className="file-size">{formatBytes(info.data.size)}</span>}
              </>
            )}
          </span>
          <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMenu(false)}>
            <button id={`${id}-menuButton`} type="button" className="icon-btn" aria-label="Open file options menu" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              <Ellipsis />
            </button>
            {menu && (
              <MenuPopover className="popover menu image-menu file-menu" onClose={() => setMenu(false)} aria-labelledby={`${id}-menuButton`}>
                <button type="button" role="menuitem" className="menu-item" disabled={readOnly} onClick={() => (setMenu(false), pick())}>
                  <Upload /> Upload
                </button>
                <hr />
                <button type="button" role="menuitem" className="menu-item" disabled={readOnly} onClick={() => (setMenu(false), setBrowsing(true))}>
                  <SearchIcon /> Select
                </button>
                <a role="menuitem" className="menu-item" href={url} download={name ?? true} onClick={() => setMenu(false)}>
                  <Download /> Download
                </a>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => (setMenu(false), navigator.clipboard.writeText(new URL(url!, location.href).href).then(() => toast({title: 'The URL is copied to the clipboard'})))}
                >
                  <Copy /> Copy URL
                </button>
                <hr />
                <button type="button" role="menuitem" className="menu-item danger" disabled={readOnly} onClick={() => (setMenu(false), onChange(undefined))}>
                  <Reset /> Clear field
                </button>
              </MenuPopover>
            )}
          </div>
        </div>
      )}
      {browsing && <FilePicker title={title} path={id} accept={accept} openRef={openRef} onPick={(next) => (setBrowsing(false), use(next))} onClose={() => setBrowsing(false)} />}
    </div>
  )
}

/** Sanity's "Select file for <field>": the accepted files as a table; each row's "…" shows where it is used. */
function FilePicker({title, path, accept, openRef, onPick, onClose}: {title: string; path: string; accept?: string; openRef: OpenRef; onPick: (ref: string) => void; onClose: () => void}) {
  const {data: files, isPending, error} = useQuery({
    queryKey: ['media-files', accept ?? ''],
    queryFn: () => fetch(`/api/media/files${accept ? `?accept=${encodeURIComponent(accept)}` : ''}`).then((r) => (r.ok ? (r.json() as Promise<FileAsset[]>) : Promise.reject(new Error(`files → ${r.status}`)))),
  })
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [usageOf, setUsageOf] = useState<FileAsset | null>(null)
  return (
    <PaneOverlay>
      <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <DialogBox className="dialog asset-dialog file-dialog" aria-modal="true" aria-labelledby={`${path}-files-title`} onClose={onClose}>
          <header>
            <h2 id={`${path}-files-title`}>Select file for "{title}"</h2>
            <button type="button" className="icon-btn" aria-label="Close dialog" onClick={onClose}>
              <CloseIcon />
            </button>
          </header>
          <div className="dialog-body">
            {accept && (
              <p className="accept-note">
                <InfoOutline /> Only showing assets of accepted types: <strong>{accept}</strong>
              </p>
            )}
            {isPending && <p className="muted">Loading files…</p>}
            {error && <p role="alert">Could not load the files: {(error as Error).message}</p>}
            {files && (
              <table className="file-table">
                <thead>
                  <tr>
                    <th>Filename</th>
                    <th>Size</th>
                    <th>Type</th>
                    <th>Date added</th>
                    <th aria-label="Actions" />
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
                        <td>{humanBytes(f.size)}</td>
                        <td>{mimeTitle(f.mimeType)}</td>
                        <td>{f.createdAt && ago(f.createdAt)}</td>
                        <td>
                          <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMenuFor(null)}>
                            <button id={`file-${f.id}-menuButton`} type="button" className="icon-btn" aria-label={`${f.name}: more`} aria-haspopup="menu" aria-expanded={menuFor === f.id} onClick={() => setMenuFor(menuFor === f.id ? null : f.id)}>
                              <Ellipsis />
                            </button>
                            {menuFor === f.id && (
                              <MenuPopover className="popover menu image-menu" onClose={() => setMenuFor(null)} aria-labelledby={`file-${f.id}-menuButton`}>
                                <button type="button" role="menuitem" className="menu-item" onClick={() => (setMenuFor(null), setUsageOf(f))}>
                                  <LinkIcon /> Show usage
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
          </div>
        </DialogBox>
        {usageOf && <FileUsage file={usageOf} path={path} openRef={openRef} onClose={() => setUsageOf(null)} onOpen={onClose} />}
      </div>
    </PaneOverlay>
  )
}

function FileUsage({file, path, openRef, onClose, onOpen}: {file: FileAsset; path: string; openRef: OpenRef; onClose: () => void; onOpen: () => void}) {
  const {data: uses, isPending} = useQuery({queryKey: ['media-usage', file.id], queryFn: () => fetch(`/api/media/${encodeURIComponent(file.id)}/usage`).then((r) => r.json() as Promise<{_id: string; _type: string; title?: string}[]>)})
  return (
    <div className="dialog-backdrop nested" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog usage-dialog" aria-modal="true" aria-label="Documents using file" onClose={onClose}>
        <header>
          <h2>Documents using file</h2>
          <button type="button" className="icon-btn" aria-label="Close dialog" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="dialog-body">
          {isPending && <p className="muted">Looking…</p>}
          {uses?.length === 0 && (
            <h3 className="usage-none">
              No documents are using file <code>{file.name}</code>
            </h3>
          )}
          {!!uses?.length && (
            <ul className="usage-list">
              {uses.map((u) => (
                <li key={u._id} onClick={onOpen}>
                  <PaneLink href={openRef(u._type, u._id, path).href}>
                    <DocumentIcon /> {u.title || 'Untitled'} <span className="muted">{u._type}</span>
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
