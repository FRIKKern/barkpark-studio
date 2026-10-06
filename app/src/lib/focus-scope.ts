import {useCallback, useEffect, useRef, useState} from 'react'

// J43 (F13): every dialog keeps Tab inside it, and every dialog, popover and menu
// hands focus back to whatever opened it when it closes — Sanity's behaviour.
// Menus also take arrow keys (Up/Down/Home/End) and close on Tab, like
// @sanity/ui's Menu. One hook, put on the element with `ref={scope}`.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const focusables = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement)

// Each open scope's root → its opener. A dialog opened from a menu item gets
// that item as its opener, but the menu closes as the dialog opens; on close
// the dialog follows the chain back to the menu's own opener (its "…" button).
const openers = new WeakMap<HTMLElement, HTMLElement | null>()
type Options = {
  /** A modal dialog: Tab and Shift+Tab cycle inside it. */
  trap?: boolean
  /** A menu: arrow keys move between its items; Tab closes it via `onDismiss`. */
  menu?: boolean
  /** Close it (menus on Tab; anything on Escape when given). */
  onDismiss?: () => void
}

export function useFocusScope<T extends HTMLElement>({trap = false, menu = false, onDismiss}: Options = {}) {
  // Whoever had focus when this opened (the opener). Read during the first
  // render, before an autoFocus inside moves focus.
  const [opener] = useState(() => (typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)))
  // Which scope the opener sat in, kept while it is still in the DOM.
  const [openerScope] = useState(() => opener?.closest<HTMLElement>('[data-focus-scope]') ?? null)
  const node = useRef<T | null>(null)
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const root = node.current
      if (!root) return
      if (e.key === 'Escape' && dismiss.current) {
        e.stopPropagation()
        dismiss.current()
        return
      }
      if (menu && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        const items = [...root.querySelectorAll<HTMLElement>('[role^=menuitem]:not([disabled])')]
        if (!items.length) return
        // Handled here: an outer handler (a menu-wrap's own arrow keys) must not move focus again.
        e.preventDefault()
        e.stopPropagation()
        const i = items.indexOf(document.activeElement as HTMLElement)
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
        items[next]!.focus()
        return
      }
      if (e.key !== 'Tab') return
      if (menu && dismiss.current) {
        e.preventDefault()
        e.stopPropagation()
        dismiss.current()
        return
      }
      if (!trap) return
      const els = focusables(root)
      if (!els.length) return e.preventDefault()
      const first = els[0]!
      const last = els[els.length - 1]!
      if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) (e.preventDefault(), last.focus())
      else if (!e.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) (e.preventDefault(), first.focus())
    },
    [menu, trap],
  )

  // Focus moves in if nothing inside took it (no autoFocus); it goes back out on close.
  useEffect(() => {
    const root = node.current
    if (root && !root.contains(document.activeElement)) (menu ? root.querySelector<HTMLElement>('[role^=menuitem]:not([disabled])') : focusables(root)[0])?.focus()
    return () => {
      const active = document.activeElement
      const lost = !active || active === document.body || (root && root.contains(active)) || !active.isConnected
      if (!lost) return
      const target = opener?.isConnected ? opener : openerScope && openers.get(openerScope)
      if (target?.isConnected) target.focus()
    }
  }, [menu, opener, openerScope])

  return useCallback(
    (el: T | null) => {
      node.current?.removeEventListener('keydown', onKeyDown)
      node.current = el
      if (el) (openers.set(el, opener), el.setAttribute('data-focus-scope', ''))
      el?.addEventListener('keydown', onKeyDown)
    },
    [onKeyDown, opener],
  )
}
