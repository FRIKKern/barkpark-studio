import {useState} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {DialogBox} from './FocusScopes'
import type {OpenRef} from './Fields'
import {RefPreview} from './Preview'
import {toast} from './Toasts'
import {Close as CloseIcon} from './icons'
import {useT} from '../lib/i18n'

type Use = {_id: string; _type: string; title?: string}

/**
 * J36: Sanity's asset "Delete" dialog. An asset some document uses can't be deleted:
 * it says so and lists them (each opens in the next pane). Otherwise it asks, then
 * deletes the asset and its metadata. Barkpark refuses one in use too (409 with where
 * it is used): that list replaces the lookup's, so a use made since still shows.
 */
export function AssetDeleteDialog({kind, asset, path, openRef, onClose, onOpen}: {kind: 'image' | 'file'; asset: {id: string; name: string}; path: string; openRef: OpenRef; onClose: () => void; onOpen: () => void}) {
  const t = useT()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const {data: found, isPending} = useQuery({queryKey: ['media-usage', asset.id], staleTime: 0, queryFn: () => fetch(`/api/media/${encodeURIComponent(asset.id)}/usage`).then((r) => r.json() as Promise<Use[]>)})
  const [refused, setRefused] = useState<Use[] | null>(null)
  const uses = refused ?? found
  const image = kind === 'image'
  const remove = async () => {
    setBusy(true)
    const res = await fetch(`/api/media/${encodeURIComponent(asset.id)}`, {method: 'DELETE'}).catch(() => null)
    setBusy(false)
    if (!res?.ok) {
      const listed = res?.status === 409 ? ((await res.json().catch(() => ({}))) as {uses?: Use[]}).uses : undefined
      if (listed?.length) return setRefused(listed)
      return toast({tone: 'critical', title: image ? t('Image could not be deleted') : t('File could not be deleted')})
    }
    toast({tone: 'positive', title: image ? t('Image was deleted') : t('File was deleted')})
    void qc.invalidateQueries({queryKey: ['media']})
    void qc.invalidateQueries({queryKey: ['media-files']})
    onClose()
  }
  return (
    <div className="dialog-backdrop nested" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog usage-dialog" aria-modal="true" aria-label={image ? t('Delete image') : t('Delete file')} onClose={onClose}>
        <header>
          <h2>{image ? t('Delete image') : t('Delete file')}</h2>
          <button type="button" className="icon-btn" aria-label={t('Close dialog')} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="dialog-body">
          {isPending && <p className="muted">{t('Loading…')}</p>}
          {!!uses?.length && (
            <>
              <p className="warning" role="alert">
                {image
                  ? t("{name} cannot be deleted because it's being used. In order to delete this image, you first need to remove all uses of it.", {name: asset.name})
                  : t("{name} cannot be deleted because it's being used. In order to delete this file, you first need to remove all uses of it.", {name: asset.name})}
              </p>
              <ul className="usage-list">
                {uses.map((u) => (
                  <li key={u._id} onClick={onOpen}>
                    <RefPreview type={u._type} id={u._id} href={openRef(u._type, u._id, path).href} selected={false} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {uses?.length === 0 && (
            <p>
              {image ? t('You are about to delete the image') : t('You are about to delete the file')} <strong>{asset.name}</strong> {t('and its metadata. Are you sure?')}
            </p>
          )}
        </div>
        <footer>
          <button type="button" className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          {uses?.length === 0 && (
            <button type="button" className="btn danger" disabled={busy} onClick={() => void remove()}>
              {t('Delete')}
            </button>
          )}
        </footer>
      </DialogBox>
    </div>
  )
}
