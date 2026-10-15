// J15: Review changes for a rich-text (PortableDoc) field, as Sanity draws it: only
// the blocks that changed, each in its own style (heading, list, quote, callout),
// the text diff inside it with the marks (bold, links, …) kept.
import {textDiff} from './changes.ts'

export type DocInline = {type: string; value?: string; href?: string; children?: DocInline[]}
export type DocBlock = {id: string; type: string; level?: number; tone?: string; text?: string; content?: DocInline[]; items?: DocInline[][]; ordered?: boolean} & Record<string, unknown>

/** A run of text with the marks around it (outermost first) and its link, if any. */
export type Run = {text: string; marks: string[]; href?: string}
// 'formatted': the same text, its marks changed (made bold, a link added), as Sanity marks it.
export type Piece = Run & {change: 'same' | 'added' | 'removed' | 'formatted'}
/** A block's other properties that changed (a callout's tone, a heading's level, an image's picture or alt). */
export type AttrChange = {name: string; before: unknown; after: unknown}
export type BlockChange = {kind: 'added' | 'removed' | 'changed'; block: DocBlock; was?: DocBlock; pieces: Piece[]; items?: Piece[][]; attrs?: AttrChange[]}

/** Inline nodes as flat runs. */
export function runs(nodes: DocInline[] = [], marks: string[] = [], href?: string): Run[] {
  return nodes.flatMap((n) => {
    if (n.type === 'text' || n.value !== undefined) return n.value ? [{text: n.value, marks, href}] : []
    if (n.type === 'link') return runs(n.children, marks, n.href ?? href)
    return runs(n.children, [...marks, n.type], href)
  })
}

const textOf = (rs: Run[]) => rs.map((r) => r.text).join('')

/** `count` characters from `rs` starting at `at`, split at run edges, tagged `change`. */
function take(rs: Run[], at: number, count: number, change: Piece['change']): Piece[] {
  const out: Piece[] = []
  let pos = 0
  for (const r of rs) {
    const start = Math.max(at, pos)
    const end = Math.min(at + count, pos + r.text.length)
    if (start < end) out.push({...r, text: r.text.slice(start - pos, end - pos), change})
    pos += r.text.length
  }
  return out
}

/** The word diff of two runs' texts, each piece keeping the marks of the side it comes from. */
export function diffRuns(before: Run[], after: Run[]): Piece[] {
  const out: Piece[] = []
  let b = 0
  let a = 0
  for (const s of textDiff(textOf(before), textOf(after))) {
    const n = s.text.length
    if (s.kind === 'removed') (out.push(...take(before, b, n, 'removed')), (b += n))
    else if (s.kind === 'added') (out.push(...take(after, a, n, 'added')), (a += n))
    else {
      // The same text: marked 'formatted' where its marks differ from before's.
      const was = take(before, b, n, 'same')
      const markAt = (ps: Piece[], i: number) => {
        for (const p of ps) if (i < p.text.length) return `${p.marks.join()}|${p.href ?? ''}`; else i -= p.text.length
        return ''
      }
      let at = 0
      for (const p of take(after, a, n, 'same')) {
        const differs = [...p.text].some((_, i) => markAt(was, at + i) !== `${p.marks.join()}|${p.href ?? ''}`)
        out.push(differs ? {...p, change: 'formatted'} : p)
        at += p.text.length
      }
      ;(a += n), (b += n)
    }
  }
  return out
}

const TEXT_KEYS = new Set(['id', 'type', 'content', 'items', 'text', '_key'])
/** The block's non-text properties that changed, by name. */
export function attrChanges(was: DocBlock, now: DocBlock): AttrChange[] {
  const names = [...new Set([...Object.keys(was), ...Object.keys(now)])].filter((k) => !TEXT_KEYS.has(k)).sort()
  return names.flatMap((name) => (JSON.stringify(was[name]) === JSON.stringify(now[name]) ? [] : [{name, before: was[name], after: now[name]}]))
}

const blockRuns = (b: DocBlock): Run[] => (b.content ? runs(b.content) : b.text ? [{text: b.text, marks: []}] : [])
const all = (rs: Run[], change: Piece['change']): Piece[] => rs.map((r) => ({...r, change}))
const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y)

/** The blocks that changed, in document order (a removed block where it stood). */
export function docDiff(before: DocBlock[] = [], after: DocBlock[] = []): BlockChange[] {
  const old = new Map(before.map((b) => [b.id, b]))
  const kept = new Set(after.map((b) => b.id))
  const out: BlockChange[] = []
  const removedBefore = (id: string | undefined) => {
    // Blocks gone from `after` that stood before `id` (or at the end) in `before`.
    const until = id === undefined ? before.length : before.findIndex((b) => b.id === id)
    for (const b of before.slice(0, until < 0 ? 0 : until)) if (!kept.has(b.id) && !out.some((c) => c.block === b)) out.push({kind: 'removed', block: b, pieces: all(blockRuns(b), 'removed'), items: b.items?.map((i) => all(runs(i), 'removed'))})
  }
  for (const b of after) {
    if (old.has(b.id)) removedBefore(b.id)
    const was = old.get(b.id)
    if (!was) out.push({kind: 'added', block: b, pieces: all(blockRuns(b), 'added'), items: b.items?.map((i) => all(runs(i), 'added'))})
    else if (!same(was, b)) {
      const items = b.items || was.items ? Array.from({length: Math.max(b.items?.length ?? 0, was.items?.length ?? 0)}, (_, i) => diffRuns(runs(was.items?.[i]), runs(b.items?.[i]))) : undefined
      out.push({kind: 'changed', block: b, was, pieces: diffRuns(blockRuns(was), blockRuns(b)), items, attrs: attrChanges(was, b)})
    }
  }
  removedBefore(undefined)
  return out
}
