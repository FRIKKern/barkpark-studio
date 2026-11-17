import {useCallback, useLayoutEffect, useState, type CSSProperties, type ReactNode} from 'react'
import {DialogBox, PaneOverlay} from './FocusScopes'
import {Close as CloseIcon} from './icons'
import {useT} from '../lib/i18n'
import {modalWidth, placePopover, type Modal} from '../lib/array-options'
import '../array-options.css'

// Sanity's `options.modal: {type: 'popover', width}` on an array of objects (sanity 6.17
// EnhancedObjectDialog → PopoverDialog): the item opens in a popover by its row, not in the dialog.
// Under the row and centred on it, flipped above when there is no room below, 4 px inside the pane;
// as wide as Sanity UI's container size (1: 640 px), never wider than the pane. Its header is
// "Edit <type>" ("View <type>" read-only) and a close button; the item's fields fill it, scrolling
// past the pane's height. Tab stays inside it, Escape closes it, and focus goes back to the row.

type Props = {
  /** The array's id (its SortableRows box), and the item's _key: the row it opens by. */
  arrayId: string
  itemKey: string
  typeTitle: string
  readOnly?: boolean
  width: Modal['width']
  onClose: () => void
  children: ReactNode
}

/** The item's row button (its preview) in this array's own box, not in an array inside an item. */
const rowOf = (arrayId: string, key: string) => {
  const row = document.getElementById(arrayId)?.querySelector<HTMLElement>(`:scope > .array-box > .array-row[data-key="${CSS.escape(key)}"]`)
  return row?.querySelector<HTMLElement>(':scope > .array-item-preview') ?? row ?? null
}

export function ItemPopover({arrayId, itemKey, typeTitle, readOnly, width, onClose, children}: Props) {
  const t = useT()
  // The popover's box, once drawn: PaneOverlay draws it a render after this one, in the pane.
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const title = typeTitle ? typeTitle[0]!.toUpperCase() + typeTitle.slice(1) : ''
  const header = readOnly ? t('View {name}', {name: title}) : t('Edit {name}', {name: title})
  // Sanity's handleClose: close, then focus the row it opened by.
  const close = useCallback(() => {
    const row = rowOf(arrayId, itemKey)
    onClose()
    row?.focus({preventScroll: true})
  }, [arrayId, itemKey, onClose])

  // Placed by hand, in its pane's box, and kept by its row as Sanity's (floating-ui's autoUpdate):
  // each frame it checks where the row, the pane and its own content are, and moves when any did
  // (a scroll, a resize, fields drawn later, a code editor above loading and pushing the row down).
  useLayoutEffect(() => {
    if (!el) return
    let frame = 0
    let seen = ''
    const place = () => {
      const host = el.offsetParent as HTMLElement | null
      const row = rowOf(arrayId, itemKey)
      if (!host || !row) return
      // Its content's own height (the box inside is never cut, the popover scrolls it).
      const inner = (el.firstElementChild as HTMLElement | null) ?? el
      const r = row.getBoundingClientRect()
      const h = host.getBoundingClientRect()
      const now = [r.left, r.top, r.width, r.height, h.left, h.top, h.width, h.height, inner.offsetHeight, innerWidth].join()
      if (now === seen) return
      seen = now
      const want = modalWidth(width, innerWidth)
      if (want === null) el.style.width = 'max-content'
      const at = placePopover(r, h, want ?? el.offsetWidth, inner.offsetHeight)
      Object.assign(el.style, {left: `${at.left + host.scrollLeft}px`, top: `${at.top + host.scrollTop}px`, width: `${at.width}px`, maxHeight: `${at.maxHeight}px`})
      el.dataset.side = at.side
    }
    const tick = () => (place(), (frame = requestAnimationFrame(tick)))
    tick()
    return () => cancelAnimationFrame(frame)
  }, [el, arrayId, itemKey, width])

  return (
    <PaneOverlay>
      <div ref={setEl} className="popover item-popover">
        <DialogBox className="item-popover-box" aria-label={header} onClose={close}>
          <header className="item-popover-head">
            <span className="item-popover-title">{header}</span>
            <button type="button" className="icon-btn" aria-label={t('Close')} data-tip={t('Close')} data-tip-side="top" onClick={close}>
              <CloseIcon />
            </button>
          </header>
          <div className="item-popover-body">{children}</div>
        </DialogBox>
      </div>
    </PaneOverlay>
  )
}

/** The item dialog's width when the array asks for another than Sanity's default (1: 640 px). */
export function dialogWidth(width: Modal['width']): CSSProperties | undefined {
  if (width === 1) return undefined
  const px = modalWidth(width, typeof innerWidth === 'number' ? innerWidth : 1024)
  return px === null ? {width: 'auto', maxWidth: 'calc(100% - 24px)'} : {width: `min(${px}px, calc(100% - 24px))`}
}
