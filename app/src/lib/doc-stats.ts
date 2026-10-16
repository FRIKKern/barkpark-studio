// The freeform footer's "28 words · 5 blocks" (task-dd9f680bbc4369a7), counted as
// Barkpark's LiveView counts it (paper_editor.ex beta_doc_stats/1): top-level blocks, and
// the words of every block's visible text, gathered through text, value, children,
// content, items and body; a section adds its title, a figure its caption, an action its
// label, tabs and columns their blocks. Pure, so node's tests load it.

type Node = unknown

const textOf = (n: Node): string => {
  if (typeof n === 'string') return n
  if (Array.isArray(n)) return n.map(textOf).join(' ')
  if (!n || typeof n !== 'object') return ''
  const o = n as Record<string, unknown>
  switch (o.type) {
    case 'action':
      return typeof o.label === 'string' ? o.label : ''
    case 'section':
      if (Array.isArray(o.blocks)) return `${typeof o.title === 'string' ? o.title : ''} ${textOf(o.blocks)}`
      break
    case 'tabs':
      if (Array.isArray(o.tabs)) return o.tabs.map((tab) => textOf((tab as {blocks?: unknown}).blocks)).join(' ')
      break
    case 'columns':
      if (Array.isArray(o.columns)) return o.columns.filter(Array.isArray).map(textOf).join(' ')
      break
    case 'figure':
      return `${textOf(o.child)} ${typeof o.caption === 'string' ? o.caption : textOf(o.caption)}`
  }
  return ['text', 'value', 'children', 'content', 'items', 'body'].map((k) => textOf(o[k])).join(' ')
}

/** Top-level blocks and the words in them. */
export function docStats(blocks: unknown): {words: number; blocks: number} {
  if (!Array.isArray(blocks)) return {words: 0, blocks: 0}
  const words = blocks.reduce<number>((sum, b) => sum + textOf(b).split(/\s+/).filter(Boolean).length, 0)
  return {words, blocks: blocks.length}
}
