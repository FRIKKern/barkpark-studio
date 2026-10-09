/**
 * Put the caret in a doc pane's first field once that pane has mounted: the Classic
 * form's first input, or the canvas's first block (D04; the canvas mounts after the
 * doc is created and its editor has loaded, so this waits up to `ms`).
 */
export function focusFirstField(id: string, ms = 5000) {
  const until = performance.now() + ms
  const tick = () => {
    const pane = document.querySelector(`[data-pane="doc:${id}"]`)
    // The first field's, not the field-group select (J14) above the fields.
    const input = pane?.querySelector<HTMLElement>('.doc-form .input:not(.group-select .input)')
    if (input) return input.focus()
    const canvas = pane?.querySelector<HTMLElement & {focusFirstBodyBlock?: () => boolean}>('bp-paper-canvas')
    const first = canvas?.querySelector('.ProseMirror')?.firstElementChild
    if (first) {
      const control = first.querySelector<HTMLElement>('.bp-canvas-field-control')
      return control ? control.focus() : void canvas?.focusFirstBodyBlock?.()
    }
    if (performance.now() < until) requestAnimationFrame(tick)
  }
  tick()
}
