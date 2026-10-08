// J15: Review changes for a rich-text (PortableDoc) field, as Sanity draws it: only
// the blocks that changed, each in its own style (heading, list, quote, callout),
// the text diff inside it with the marks (bold, links, …) kept.
import {textDiff} from './changes.ts'

export type DocInline = {type: string; value?: string; href?: string; children?: DocInline[]}
export type DocBlock = {id: string; type: string; level?: number; tone?: string; text?: string; content?: DocInline[]; items?: DocInline[][]; ordered?: boolean}

/** A run of text with the marks around it (outermost first) and its link, if any. */
export type Run = {text: string; marks: string[]; href?: string}
export type Piece = Run & {change: 'same' | 'added' | 'removed'}
export type BlockChange = {kind: 'added' | 'removed' | 'changed'; block: DocBlock; pieces: Piece[]; items?: Piece[][]}

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
    else (out.push(...take(after, a, n, 'same')), (a += n), (b += n))
  }
  return out
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
      out.push({kind: 'changed', block: b, pieces: diffRuns(blockRuns(was), blockRuns(b)), items})
    }
  }
  removedBefore(undefined)
  return out
}
