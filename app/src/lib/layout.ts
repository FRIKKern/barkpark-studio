// Which panes collapse to strips. Sanity's rule, measured on the reference:
// a list pane needs 320 px, a document pane 640 px, a strip is 51 px. The focused
// pane (last, unless a strip was clicked) always stays open; then panes are opened
// right to left while they still fit.
export const STRIP = 51
const NEED = {types: 320, list: 320, doc: 640} as const

export function collapsed(kinds: (keyof typeof NEED)[], width: number, focus = kinds.length - 1): boolean[] {
  const out = kinds.map((_, i) => i !== focus)
  let used = NEED[kinds[focus]] + STRIP * (kinds.length - 1)
  for (let i = kinds.length - 1; i >= 0; i--) {
    if (i === focus) continue
    const extra = NEED[kinds[i]] - STRIP
    if (used + extra > width) break
    used += extra
    out[i] = false
  }
  return out
}
