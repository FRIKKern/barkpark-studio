import {useEffect} from 'react'

// Keyboard: an action inside a field can take the focused element away with it (Remove in
// an array item's menu, a reference picked in a new item, an asset chosen in the media
// dialog); focus then fell to the page and the next Tab started from the top. Sanity drops it
// the same way. Here it goes back to the field it was in, to the control now at the place the
// lost one had (the picked reference, the item after a removed one, the image's buttons).
// Only when the focused element itself left the page: a click on empty space keeps its
// usual behaviour (nothing focused).

const CONTROL = 'input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"]), [contenteditable=true]'
// The field's own buttons (Field actions, Add comment) are not where its value is.
const SKIP = '.field-actions, .comment-add, .field-comments, .change-bar'

export function useFocusRescue(root: HTMLElement | null) {
  useEffect(() => {
    if (!root) return
    const controls = (f: HTMLElement) => [...f.querySelectorAll<HTMLElement>(CONTROL)].filter((el) => !el.closest(SKIP) && el.offsetParent !== null)
    let last: Element | null = null
    let field: HTMLElement | null = null
    let at = 0
    const onFocusIn = (e: FocusEvent) => {
      last = e.target as Element
      const f = root.contains(last) ? last.closest<HTMLElement>('.field') : null
      if (f) (field = f), (at = Math.max(0, controls(f).indexOf(last as HTMLElement)))
    }
    const rescue = () => {
      const active = document.activeElement
      if (!last || last.isConnected || (active && active !== document.body) || !field?.isConnected) return
      const list = controls(field)
      last = null
      list[Math.min(at, list.length - 1)]?.focus()
    }
    const watch = new MutationObserver(() => requestAnimationFrame(rescue))
    document.addEventListener('focusin', onFocusIn)
    watch.observe(document.body, {childList: true, subtree: true})
    return () => (document.removeEventListener('focusin', onFocusIn), watch.disconnect())
  }, [root])
}
