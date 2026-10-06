import {useCallback, useState, type HTMLAttributes, type ReactNode} from 'react'
import {createPortal} from 'react-dom'
import {useFocusScope} from '../lib/focus-scope'

// The two shapes J43 needs, so every dialog and menu behaves the same: render one
// only while it is open (that's when it learns who opened it).

type DivProps = HTMLAttributes<HTMLDivElement> & {children: ReactNode; onClose: () => void}

/** A menu popover: arrow keys move, Escape and Tab close, focus returns to its button. */
export function MenuPopover({onClose, className = 'popover menu', children, ...rest}: DivProps) {
  const scope = useFocusScope<HTMLDivElement>({menu: true, onDismiss: onClose})
  return (
    <div ref={scope} className={className} role="menu" {...rest}>
      {children}
    </div>
  )
}

/** A dialog (modal or popover confirm): Tab stays inside, Escape closes, focus returns to its opener. */
export function DialogBox({onClose, children, ...rest}: DivProps) {
  const scope = useFocusScope<HTMLDivElement>({trap: true, onDismiss: onClose})
  return (
    <div ref={scope} role="dialog" {...rest}>
      {children}
    </div>
  )
}

/**
 * Draw a field's dialog over its whole document pane, as Sanity does, not inside
 * the field (a field is `position: relative`, so an absolute backdrop would stop
 * at its edges). Children render once the pane is found.
 */
export function PaneOverlay({children}: {children: ReactNode}) {
  const [pane, setPane] = useState<HTMLElement | null>(null)
  const anchor = useCallback((el: HTMLSpanElement | null) => setPane(el?.closest<HTMLElement>('.pane.doc') ?? null), [])
  return (
    <>
      <span ref={anchor} hidden />
      {pane && createPortal(children, pane)}
    </>
  )
}
