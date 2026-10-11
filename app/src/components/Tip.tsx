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
  const show = (e: {currentTarget: Element; type: string}) => {
    const el = e.currentTarget
    // Focus from a click is not keyboard focus: the click already hid it (Sanity's).
    if (e.type === 'focus' && !el.matches(':focus-visible')) return
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

/**
 * J57: Sanity's tooltip on every icon button. Mark the button with `data-tip="Label"`
 * (and `data-tip-keys="Ctrl+K"` for its shortcut); this one layer, mounted once in the
 * root, shows it after the same pause on hover or keyboard focus and hides it on
 * leave, blur, Escape or a click. A disabled button keeps its `title` with the reason.
 */
export function IconTips() {
  const [shown, setShown] = useState<{rect: DOMRect; text: string; keys?: string[]} | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let current: Element | null = null
    const hide = () => (clearTimeout(timer), (current = null), setShown(null))
    const show = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]')
      if (!el || el === current) return
      // The focus a click gives is not keyboard focus: the click hid the tip, it stays hidden.
      if (e.type === 'focusin' && !el.matches(':focus-visible')) return
      hide()
      current = el
      timer = setTimeout(() => {
        const keys = el.getAttribute('data-tip-keys')
        setShown({rect: el.getBoundingClientRect(), text: el.getAttribute('data-tip') ?? '', keys: keys ? keys.split('+') : undefined})
      }, 300)
    }
    const leave = (e: Event) => {
      const to = (e as PointerEvent | FocusEvent).relatedTarget as Node | null
      if (current && !(to && current.contains(to))) hide()
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && hide()
    document.addEventListener('pointerover', show)
    document.addEventListener('focusin', show)
    document.addEventListener('pointerout', leave)
    document.addEventListener('focusout', leave)
    document.addEventListener('pointerdown', hide)
    document.addEventListener('keydown', esc)
    addEventListener('scroll', hide, true)
    return () => {
      hide()
      document.removeEventListener('pointerover', show)
      document.removeEventListener('focusin', show)
      document.removeEventListener('pointerout', leave)
      document.removeEventListener('focusout', leave)
      document.removeEventListener('pointerdown', hide)
      document.removeEventListener('keydown', esc)
      removeEventListener('scroll', hide, true)
    }
  }, [])
  if (!shown) return null
  const {rect, text, keys} = shown
  const below = rect.bottom + 80 < innerHeight
  return createPortal(
    <span
      role="tooltip"
      className="hover-tip icon-tip"
      style={{left: Math.min(Math.max(rect.left + rect.width / 2, 100), innerWidth - 100), ...(below ? {top: rect.bottom + 6} : {bottom: innerHeight - rect.top + 6})}}
    >
      <span className="tip-line">
        {text}
        {keys && (
          <span className="keys">
            {keys.map((k) => (
              <kbd key={k}>{k}</kbd>
            ))}
          </span>
        )}
      </span>
    </span>,
    document.body,
  )
}
