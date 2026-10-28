// Docs whose first field focusFirstField is placing the caret in: their pane leaves focus to it.
const placing = new Set<string>()

/**
 * Put the caret in a doc pane's first field once that pane has mounted: the Classic
 * form's first input, or the canvas's first block (D04; the canvas mounts after the
 * doc is created and its editor has loaded). It waits as long as the doc takes to
 * load, up to `ms`: a slow Barkpark read (seconds, in CI) used to outlast a 5 s wait
 * and leave the caret on the page body (J19). Once there it holds the place until
 * the editor acts (a key, the pointer) or leaves the pane, or `ms` has passed: what
 * the panes do as their slow reads land (a list loading beside it) can't drop it.
 */
export function focusFirstField(id: string, ms = 30_000) {
  const until = performance.now() + ms
  let seen = false
  let took = false
  const takeOver = () => (took = true)
  addEventListener('keydown', takeOver, {capture: true, once: true})
  addEventListener('pointerdown', takeOver, {capture: true, once: true})
  placing.add(id)
  const done = () => (placing.delete(id), removeEventListener('keydown', takeOver, {capture: true}), removeEventListener('pointerdown', takeOver, {capture: true}))
  const place = (pane: Element): boolean => {
    // The first field's, not the field-group select (J14) above the fields.
    const input = pane.querySelector<HTMLElement>('.doc-form .input:not(.group-select .input)')
    if (input) return document.activeElement === input || (input.focus(), document.activeElement === input)
    const canvas = pane.querySelector<HTMLElement & {focusFirstBodyBlock?: () => boolean}>('bp-paper-canvas')
    const first = canvas?.querySelector('.ProseMirror')?.firstElementChild
    if (!first) return false
    if (canvas!.contains(document.activeElement)) return true
    const control = first.querySelector<HTMLElement>('.bp-canvas-field-control')
    if (control) control.focus()
    else canvas!.focusFirstBodyBlock?.()
    return true
  }
  const tick = () => {
    const now = performance.now()
    if (took || now > until) return done()
    const pane = document.querySelector(`[data-pane="doc:${id}"]`)
    if (seen && !pane) return done() // the editor went elsewhere
    seen ||= !!pane
    // Placed and still there (in this pane): nothing to do this frame. The pane itself
    // focused (it takes focus as it opens) is not placed: the field still has to be.
    const here = !!pane && document.activeElement !== pane && pane.contains(document.activeElement)
    if (pane && !here) place(pane)
    requestAnimationFrame(tick)
  }
  tick()
}

const TABBABLE = 'a[href], button, input, select, textarea, [tabindex], [contenteditable=true]'
/**
 * Sanity moves focus into a document's form as it becomes ready (its FormView's
 * focusFirstDescendant): the first thing in it that takes focus, "All fields" (a group
 * tab Tab itself skips) or the first field's actions. Not the "Used on N pages" banner: Sanity's arrives after its focus
 * moved. Focus that is already in the pane (a field from `path=`, focusFirstField),
 * in a box being typed in (the list search), or in a dialog or menu stays; a key or a
 * click, or focus going elsewhere, while the form is still drawing cancels it.
 * Returns the cleanup.
 */
export function focusIntoForm(pane: HTMLElement, id: string, ms = 5_000): () => void {
  const first = () =>
    [...pane.querySelectorAll<HTMLElement>(`.doc-form :is(${TABBABLE})`)].find(
      (e) => (e.tabIndex >= 0 || e.matches('a[href], button, input, select, textarea')) && !(e as HTMLButtonElement).disabled && !e.closest('.locations-banner, [hidden]') && e.getClientRects().length > 0,
    )
  const stays = () => {
    if (placing.has(id)) return true
    const a = document.activeElement as HTMLElement | null
    if (!a || a === document.body || a === pane) return false
    return pane.contains(a) || a.matches('input, textarea, select') || a.isContentEditable || !!a.closest('[role=dialog], [role=menu], [role=listbox]')
  }
  const place = () => {
    if (stays()) return true
    const el = first()
    el?.focus({preventScroll: true})
    return !!el
  }
  let cancelled = false
  const cancel = () => (cancelled = true)
  const left = (e: FocusEvent) => !pane.contains(e.target as Node) && cancel()
  // A pane still settling its width can hide what took focus: at 768 the field-group select
  // gives way to the tabs as the panes beside it fold, and focus falls to the page. Place
  // it again, on what shows now.
  const dropped = (e: FocusEvent) => {
    const gone = e.target as HTMLElement
    if (cancelled || e.relatedTarget || !pane.contains(gone)) return
    requestAnimationFrame(() => !cancelled && document.activeElement === document.body && !gone.getClientRects().length && place())
  }
  addEventListener('keydown', cancel, {capture: true})
  addEventListener('pointerdown', cancel, {capture: true})
  addEventListener('focusin', left, {capture: true})
  addEventListener('focusout', dropped, {capture: true})
  const placed = place()
  const observer = new MutationObserver(() => !placed && (cancelled || place()) && observer.disconnect())
  const timer = setTimeout(() => stop(), ms)
  const stop = () => {
    observer.disconnect()
    clearTimeout(timer)
    removeEventListener('keydown', cancel, {capture: true})
    removeEventListener('pointerdown', cancel, {capture: true})
    removeEventListener('focusin', left, {capture: true})
    removeEventListener('focusout', dropped, {capture: true})
  }
  if (!placed) observer.observe(pane, {childList: true, subtree: true})
  return stop
}
