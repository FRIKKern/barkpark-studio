import {useEffect, useId, useRef, useState, type ReactNode} from 'react'
import {createPortal} from 'react-dom'

/**
 * Sanity's hover tooltip: shown after a short pause on hover or keyboard focus,
 * hidden on leave, blur or Escape (WCAG 1.4.13). Drawn in a fixed layer on <body>,
 * so a pane's scroll box never clips it. `content` is called only while shown:
 * relative times are fresh and nothing differs between server and client render.
 * Spread `anchor` on the element it describes and render `tip` anywhere.
 */
/**
 * Sanity's placement: centred on the anchor, 4 px under it (over it near the bottom;
 * over it always for a field's ⋯ and Add comment, `data-tip-side="top"`, unless at the top),
 * shifted only as far as it must to stay 4 px inside the anchor's pane (else the
 * window), measured once drawn.
 */
const fit = (el: HTMLElement | null) => {
  if (!el) return
  const half = el.offsetWidth / 2
  const [lo, hi] = (el.dataset.bounds ?? `0 ${innerWidth}`).split(' ').map(Number)
  el.style.left = `${Math.min(Math.max(Number(el.dataset.centre), lo! + half + 4), hi! - half - 4)}px`
}
const placed = (at: DOMRect, anchor?: Element | null) => {
  const centre = at.left + at.width / 2
  const pane = anchor?.closest('.pane')?.getBoundingClientRect()
  const above = anchor?.getAttribute('data-tip-side') === 'top' ? at.top > 80 : at.bottom + 80 >= innerHeight
  return {ref: fit, 'data-centre': centre, 'data-bounds': pane ? `${pane.left} ${pane.right}` : undefined, style: {left: centre, ...(above ? {bottom: innerHeight - at.top + 4} : {top: at.bottom + 4})}}
}

export function useTip(content: () => ReactNode) {
  const id = useId()
  const [at, setAt] = useState<DOMRect | null>(null)
  const anchorEl = useRef<Element | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const show = (e: {currentTarget: Element; type: string}) => {
    const el = e.currentTarget
    // Focus from a click is not keyboard focus: the click already hid it (Sanity's).
    if (e.type === 'focus' && !el.matches(':focus-visible')) return
    clearTimeout(timer.current)
    anchorEl.current = el
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
  const tip =
    at &&
    createPortal(
      <span role="tooltip" id={id} className="hover-tip" {...placed(at, anchorEl.current)}>
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
  const [shown, setShown] = useState<{el: Element; rect: DOMRect; text: string; keys?: string[]} | null>(null)
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
        setShown({el, rect: el.getBoundingClientRect(), text: el.getAttribute('data-tip') ?? '', keys: keys ? keys.split('+') : undefined})
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
  const {el, rect, text, keys} = shown
  return createPortal(
    <span role="tooltip" className="hover-tip icon-tip" {...placed(rect, el)}>
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
