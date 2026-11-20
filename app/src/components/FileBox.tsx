import {useLayoutEffect, type ClipboardEvent, type DragEvent, type MouseEvent, type ReactNode} from 'react'
import {BinaryDocumentIcon, Ellipsis, ErrorOutline, Search as SearchIcon, Undo, Upload} from './icons'
import type {Field} from '../lib/data'
import {useFileInfo} from '../lib/file-info'
import {formatBytes} from '../lib/files'
import {focusIn, holdAct, settleBox, type Act} from '../lib/held-act'
import {useLocale, useT} from '../lib/i18n'

// task-05dcdef359da08fc: the file input's box, one markup for both sides. The real input (FileInput,
// in the editors' chunk) draws it with its handlers; before that chunk is here (DocEditors.tsx) the
// same box is drawn on its own, so it never vanishes from the form. On its own it does nothing a
// person loses: a press is kept for the real input (lib/held-act.ts), a dropped file is refused, said
// (DocEditors.tsx, guardDrops).

export type DropHandlers = {
  onDragEnter?: (e: DragEvent<HTMLElement>) => void
  onDragOver?: (e: DragEvent<HTMLElement>) => void
  onDragLeave?: (e: DragEvent<HTMLElement>) => void
  onDrop?: (e: DragEvent<HTMLElement>) => void
  onPaste?: (e: ClipboardEvent<HTMLElement>) => void
}
/** What the real input hands the box: its handlers, and what only it draws (progress, an open menu). */
export type FileBoxLive = {
  target: DropHandlers
  overlay: ReactNode
  chooser: ReactNode
  uploading: ReactNode | null
  failed: boolean
  onRetry: () => void
  act: (act: Act) => void
  menu: boolean
  menuItems: ReactNode
  onMenuBlur: () => void
}
type Props = {id: string; field: Field; value: unknown; readOnly?: boolean; live?: FileBoxLive; children?: ReactNode}
type FileValue = {_type?: string; asset?: {_type?: string; _ref?: string}}

export const carriesFiles = (e: DragEvent<HTMLElement>) => [...e.dataTransfer.types].includes('Files')

export function FileBox({id, field, value, readOnly, live, children}: Props) {
  const t = useT()
  const locale = useLocale()
  const file = (value && typeof value === 'object' ? value : {}) as FileValue
  const ref = file.asset?._ref
  const accept = (field.options as {accept?: string} | undefined)?.accept
  const info = useFileInfo(ref)
  const title = field.title ?? field.name
  const name = info.data?.name
  // A press: the real input's, or kept for it by the button pressed (lib/held-act.ts).
  const press = (act: Act) => (e: MouseEvent<HTMLButtonElement>) => (live ? live.act(act) : holdAct(id, act, e.currentTarget))
  // Drawn before the chunk: as React takes this box away for the real one, what had the focus in it
  // (and so whether a held press stands) is read, before the box leaves the page (lib/held-act.ts).
  const before = !live
  useLayoutEffect(() => (before ? () => settleBox(id, focusIn(id)) : undefined), [before, id])
  // Before the chunk a dropped file is kept from the tab by DocEditors.tsx (guardDrops), server HTML or this.
  const target = live?.target ?? {}
  return (
    <div className="file-input" id={id}>
      {/* The chooser's accept is a hint the browser lets the editor override ("All files"): a file it
          doesn't accept is refused here as a drop is, not uploaded and stored (Sanity's refuses it). */}
      {live ? live.chooser : <input type="file" accept={accept} hidden />}
      {live?.uploading ? (
        live.uploading
      ) : !ref ? (
        // Focusable so a paste has somewhere to land.
        <div className="file-box empty" tabIndex={readOnly ? undefined : 0} aria-label={t('{title}: drop, paste or upload a file', {title})} {...target}>
          {live?.overlay}
          {live?.failed ? (
            <span className="hint failed" role="alert">
              <ErrorOutline /> {t('Upload failed')}
            </span>
          ) : (
            <span className="hint">
              <BinaryDocumentIcon /> {readOnly ? t('Read only') : t('Drag or paste file here')}
            </span>
          )}
          <span className="file-actions">
            {live?.failed && (
              <button type="button" className="btn ghost" onClick={live.onRetry}>
                <Undo /> {t('Retry')}
              </button>
            )}
            <button type="button" className="btn ghost" data-act="upload" disabled={readOnly} onClick={press('upload')}>
              <Upload /> {t('Upload')}
            </button>
            <button type="button" className="btn ghost" data-act="select" disabled={readOnly} onClick={press('select')}>
              <SearchIcon /> {t('Select')}
            </button>
          </span>
        </div>
      ) : (
        <div className="file-box" tabIndex={readOnly ? undefined : 0} aria-label={t('{title}: drop or paste a file to replace it', {title})} {...target}>
          {live?.overlay}
          <span className="file-icon">
            <BinaryDocumentIcon />
          </span>
          <span className="file-text">
            {info.isError ? (
              <span className="file-name">{t('File unavailable')}</span>
            ) : (
              <>
                <span className="file-name">{name ?? '…'}</span>
                {info.data && <span className="file-size">{formatBytes(info.data.size, locale)}</span>}
              </>
            )}
          </span>
          <div className="menu-wrap" onBlur={(e) => live && !e.currentTarget.contains(e.relatedTarget) && live.onMenuBlur()}>
            <button id={`${id}-menuButton`} type="button" className="icon-btn" data-act="menu" aria-label={t('Open file options menu')} aria-haspopup="menu" aria-expanded={!!live?.menu} onClick={press('menu')}>
              <Ellipsis />
            </button>
            {live?.menu && live.menuItems}
          </div>
        </div>
      )}
      {children}
    </div>
  )
}
