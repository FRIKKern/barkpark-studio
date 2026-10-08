import {useEffect, useId, useRef, useState, type ReactNode} from 'react'
import {createPortal} from 'react-dom'

/**
 * Sanity's hover tooltip: shown after a short pause on hover or keyboard focus,
 * hidden on leave, blur or Escape (WCAG 1.4.13). Drawn in a fixed layer on <body>,
 * so a pane's scroll box never clips it. `content` is called only while shown:
 * relative times are fresh and nothing differs between server and client render.
 * Spread `anchor` on the element it describes and render `tip` anywhere.
 */
export function useTip(content: () => ReactNode) {
  const id = useId()
  const [at, setAt] = useState<DOMRect | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const show = (e: {currentTarget: Element}) => {
    const el = e.currentTarget
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setAt(el.getBoundingClientRect()), 300)
  }
  const hide = () => (clearTimeout(timer.current), setAt(null))
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    if (!at) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAt(null)
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [at])
  const anchor = {onMouseEnter: show, onMouseLeave: hide, onFocus: show, onBlur: hide, 'aria-describedby': at ? id : undefined}
  const below = at && at.bottom + 80 < innerHeight
  const tip =
    at &&
    createPortal(
      <span
        role="tooltip"
        id={id}
        className="hover-tip"
        style={{left: Math.min(Math.max(at.left + at.width / 2, 150), innerWidth - 150), ...(below ? {top: at.bottom + 6} : {bottom: innerHeight - at.top + 6})}}
      >
        {content()}
      </span>,
      document.body,
    )
  return {anchor, tip}
}

/** The key that pairs with Enter etc. in a hotkey hint, as Sanity names it. */
export const modKey = () => (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd' : 'Ctrl')
