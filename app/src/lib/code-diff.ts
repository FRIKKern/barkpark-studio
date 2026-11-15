// Review changes for a code field (lib/code-input.ts): two versions of code as rows. Pure.

export type CodeDiffRow = {kind: 'same' | 'removed' | 'added'; text: string; was?: number; now?: number} | {kind: 'skip'; count: number}
/**
 * Two versions of code as rows, line by line: a removed line with its old number, an added
 * one with its new, and `context` unchanged lines around each change (the rest folded into
 * a skip row). Lines are matched by their longest common run; beyond `limit` cells of work
 * the changed middle is shown as removed then added.
 */
export function codeDiffRows(before: string, after: string, context = 2, limit = 4_000_000): CodeDiffRow[] {
  const a = before === '' ? [] : before.split('\n')
  const b = after === '' ? [] : after.split('\n')
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const [n, m] = [a.length - head - tail, b.length - head - tail]
  const rows: Exclude<CodeDiffRow, {kind: 'skip'}>[] = []
  for (let i = 0; i < head; i++) rows.push({kind: 'same', text: a[i]!, was: i + 1, now: i + 1})
  if (n * m > limit) {
    for (let i = 0; i < n; i++) rows.push({kind: 'removed', text: a[head + i]!, was: head + i + 1})
    for (let j = 0; j < m; j++) rows.push({kind: 'added', text: b[head + j]!, now: head + j + 1})
  } else {
    // Longest common subsequence of the changed middle, from the end, so a walk from the start reads it.
    const width = m + 1
    const table = new Uint32Array((n + 1) * width)
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i * width + j] = a[head + i] === b[head + j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!)
    let [i, j] = [0, 0]
    while (i < n || j < m) {
      if (i < n && j < m && a[head + i] === b[head + j]) rows.push({kind: 'same', text: a[head + i]!, was: head + ++i, now: head + ++j})
      else if (i < n && (j >= m || table[(i + 1) * width + j]! >= table[i * width + j + 1]!)) rows.push({kind: 'removed', text: a[head + i]!, was: head + ++i})
      else rows.push({kind: 'added', text: b[head + j]!, now: head + ++j})
    }
  }
  for (let k = 0; k < tail; k++) rows.push({kind: 'same', text: a[a.length - tail + k]!, was: a.length - tail + k + 1, now: b.length - tail + k + 1})
  // Unchanged lines further than `context` from a change fold away.
  const near = new Uint8Array(rows.length)
  rows.forEach((r, at) => {
    if (r.kind !== 'same') for (let k = Math.max(0, at - context); k <= Math.min(rows.length - 1, at + context); k++) near[k] = 1
  })
  const out: CodeDiffRow[] = []
  for (let at = 0; at < rows.length; at++) {
    if (near[at]) out.push(rows[at]!)
    else {
      const last = out.at(-1)
      if (last?.kind === 'skip') last.count++
      else out.push({kind: 'skip', count: 1})
    }
  }
  return out
}
