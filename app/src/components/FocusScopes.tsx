import type {HTMLAttributes, ReactNode} from 'react'
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
