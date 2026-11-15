// The code field's highlighted lines (lib/code-input.ts): a toggle, and where they go when the
// code is edited. Pure; loaded with the editor (components/CodeEditor.tsx).

/** A click on a line number: the line highlighted or not, the list kept in line order. */
export function toggleLine(lines: number[], line: number): number[] {
  return lines.includes(line) ? lines.filter((n) => n !== line) : [...lines, line].sort((a, b) => a - b)
}

/** One replaced range of the text before an edit: [from, to) became `insert` characters. */
export type TextChange = {from: number; to: number; insert: number}

/** The one range that turns `before` into `after` (what is left between their common start and end). */
export function changeBetween(before: string, after: string): TextChange | null {
  if (before === after) return null
  let start = 0
  const max = Math.min(before.length, after.length)
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++
  let end = 0
  while (end < max - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)) end++
  return {from: start, to: before.length - end, insert: after.length - end - start}
}

/**
 * The highlighted lines after an edit, as the plugin moves them: a highlight follows its
 * line's content (a line added above pushes it down, one removed above pulls it up, a line
 * break typed at its start takes it along), and goes only when its line is deleted (its
 * content and one of its line breaks). `changes` are in the order of the text, not
 * overlapping, in `before`'s offsets.
 */
export function moveHighlights(lines: number[], before: string, changes: TextChange[], after: string): number[] {
  if (!lines.length || !changes.length) return lines
  const starts = lineStarts(before)
  const afterStarts = lineStarts(after)
  // Where an offset of `before` lands in `after`, past text inserted at it.
  const mapPos = (pos: number) => {
    let shift = 0
    for (const c of changes) {
      if (c.from > pos) break
      // Inside what was replaced: the end of what replaced it.
      if (pos < c.to) return c.from + shift + c.insert
      shift += c.insert - (c.to - c.from)
    }
    return pos + shift
  }
  // The plugin's isRemoved: every character of [from, to) is inside a changed range.
  const removed = (from: number, to: number) => {
    let pos = from
    for (const c of changes) if (c.from <= pos && c.to > pos) pos = c.to
    return pos >= to
  }
  const out: number[] = []
  for (const n of lines) {
    if (n > starts.length) continue
    const from = starts[n - 1]!
    const to = n < starts.length ? starts[n]! - 1 : before.length
    const breakGone = (from > 0 && removed(from - 1, from)) || (to < before.length && removed(to, to + 1))
    if (breakGone && removed(from, to)) continue
    const line = lineAt(afterStarts, Math.min(mapPos(from), after.length))
    if (out.at(-1) !== line) out.push(line)
  }
  return out
}

const lineStarts = (text: string) => {
  const out = [0]
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) out.push(i + 1)
  return out
}
/** The 1-based line an offset is on. */
function lineAt(starts: number[], pos: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid]! <= pos) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}
