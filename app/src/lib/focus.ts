/** Put the caret in a doc pane's first input once that pane has mounted. */
export function focusFirstField(id: string, frames = 30) {
  const el = document.querySelector<HTMLElement>(`[data-pane="doc:${id}"] .doc-form .input`)
  if (el) el.focus()
  else if (frames > 0) requestAnimationFrame(() => focusFirstField(id, frames - 1))
}
