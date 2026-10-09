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
  const done = () => (removeEventListener('keydown', takeOver, {capture: true}), removeEventListener('pointerdown', takeOver, {capture: true}))
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
    // Placed and still there (in this pane): nothing to do this frame.
    const here = pane?.contains(document.activeElement)
    if (pane && !here) place(pane)
    requestAnimationFrame(tick)
  }
  tick()
}
