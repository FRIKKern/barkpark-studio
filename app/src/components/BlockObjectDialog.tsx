import {useCallback, useState} from 'react'
import {DialogBox, PaneOverlay} from './FocusScopes'
import {EditPathContext, FieldView, ParentContext, type OpenRef} from './Fields'
import {Close as CloseIcon} from './icons'
import {useT} from '../lib/i18n'
import type {Field} from '../lib/data'

/** What the canvas asks (editBlockObject, Barkpark EMBED-CONTRACT 1.5). */
export type BlockObjectRequest = {
  type: string
  title: string
  inline: boolean
  fields: Field[]
  value: {type: string} & Record<string, unknown>
  error: {field: string | null; message: string} | null
}

// J11: Sanity edits a block object in a modal over the pane, with the same inputs as
// any object; ours too (the canvas's own popover was a small form beside the block).
// Edits apply as you make them in Sanity; here they go to the canvas when the dialog
// closes, as one change. Nothing changed answers null: nothing is inserted or edited.
// The Portable Text input (S4b) edits a markDef here too, with Remove for its annotation.
export function BlockObjectDialog({request, path, openRef, onDone, onRemove, removeLabel}: {request: BlockObjectRequest; path: string; openRef: OpenRef; onDone: (value: Record<string, unknown> | null) => void; onRemove?: () => void; removeLabel?: string}) {
  const t = useT()
  const [value, setValue] = useState(request.value)
  // Focus on the first field (the one an error names, when asked again), as Sanity's
  // modal does: once the body is in the pane (a portal, a render later), and two
  // frames on, after the dialog's own focus and the canvas taking focus back.
  const body = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          // A field's input carries its path as id (FieldView).
          const named = request.error?.field ? document.getElementById(`${path}.${request.error.field}`) : null
          ;(named ?? el.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea'))?.focus()
        }),
      )
    },
    [request, path],
  )
  const changed = JSON.stringify(value) !== JSON.stringify(request.value)
  const close = () => onDone(changed ? value : null)
  const problem = request.error && (request.fields.find((f) => f.name === request.error!.field)?.title ?? request.error.field)
  return (
    <PaneOverlay>
      <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
        <DialogBox className="dialog item-dialog" aria-modal="true" aria-label={request.title} onClose={close} data-block-object={request.type}>
          <header>
            <h2>{request.title}</h2>
            <button type="button" className="icon-btn" aria-label={t('Close dialog')} onClick={close}>
              <CloseIcon />
            </button>
          </header>
          <div className="dialog-body item-fields" ref={body}>
            {request.error && (
              <p className="pd-conflict" role="alert">
                {problem ? `${problem}: ` : ''}
                {request.error.message === 'Required' ? t('Required') : request.error.message}
              </p>
            )}
            <fieldset className="form-fields">
              {/* The dialog's value goes back as one change when it closes: no subfield writes its own path to the document. */}
              <EditPathContext.Provider value={null}>
                <ParentContext.Provider value={value}>
                  {request.fields.map((f) => (
                    <FieldView key={f.name} field={f} path={`${path}.${f.name}`} value={value[f.name]} openRef={openRef} onChange={(v) => setValue((s) => ({...s, [f.name]: v}))} />
                  ))}
                </ParentContext.Provider>
              </EditPathContext.Provider>
            </fieldset>
            {!request.fields.length && <p className="muted">{t('This type has no fields to edit.')}</p>}
          </div>
          {onRemove && (
            <footer>
              <button type="button" className="btn danger" onClick={onRemove}>
                {removeLabel ?? t('Remove')}
              </button>
            </footer>
          )}
        </DialogBox>
      </div>
    </PaneOverlay>
  )
}
