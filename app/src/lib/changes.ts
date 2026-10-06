import {cleanupSemantic, makeDiff, DIFF_DELETE, DIFF_INSERT} from '@sanity/diff-match-patch'
import type {Field, Schema} from './data'
import type {Revision} from './history'

// Review changes (J15): what the draft changed since it was last published, per
// field, and who changed it. Barkpark keeps snapshots only, so everything here is
// computed in the browser from the published version, the draft, and the
// revisions in between.

export type FieldChange = {field: Field; before: unknown; after: unknown; authors: string[]}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Top-level fields whose draft value differs from the published one, in schema order. */
export function changedFields(schema: Schema, published: Record<string, unknown> | null | undefined, draft: Record<string, unknown>): FieldChange[] {
  return schema.fields.filter((f) => !same(published?.[f.name], draft[f.name])).map((f) => ({field: f, before: published?.[f.name], after: draft[f.name], authors: []}))
}

/**
 * Who changed each field: walk the snapshots since the last publish, newest
 * first, and credit a field to the author of every snapshot where it differs from
 * the one before it. `snapshots` are [revision, content] pairs, newest first,
 * ending with the published state the draft started from.
 */
export function authorsByField(snapshots: [Revision, Record<string, unknown>][]): Map<string, string[]> {
  const out = new Map<string, Set<string>>()
  for (let i = 0; i < snapshots.length - 1; i++) {
    const [rev, now] = snapshots[i]!
    const before = snapshots[i + 1]![1]
    for (const k of new Set([...Object.keys(now), ...Object.keys(before)]))
      if (!k.startsWith('_') && !same(now[k], before[k])) (out.get(k) ?? out.set(k, new Set()).get(k)!).add(rev.author)
  }
  return new Map([...out].map(([k, v]) => [k, [...v]]))
}

/** The revisions that make up the current draft: newest first, up to (not including) the last publish. */
export function sinceLastPublish(revisions: Revision[]): {draft: Revision[]; publish?: Revision} {
  const i = revisions.findIndex((r) => r.action === 'publish')
  return i < 0 ? {draft: revisions} : {draft: revisions.slice(0, i), publish: revisions[i]}
}

export type Segment = {kind: 'same' | 'removed' | 'added'; text: string}
/** A word-level text diff, as Sanity shows it: removed struck through, added highlighted. */
export function textDiff(before: string, after: string): Segment[] {
  return cleanupSemantic(makeDiff(before, after)).map(([op, text]) => ({kind: op === DIFF_DELETE ? 'removed' : op === DIFF_INSERT ? 'added' : 'same', text}))
}

type Inline = {type: string; value?: string; children?: Inline[]}
type Block = {id?: string; content?: Inline[]; items?: {content?: Inline[]}[]; text?: string}
const inlineText = (nodes: Inline[] = []): string => nodes.map((n) => n.value ?? inlineText(n.children)).join('')
/** Plain text of a value, for diffing: strings as is, rich text block by block. */
export function asText(v: unknown): string | undefined {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  const blocks = (v as {blocks?: Block[]})?.blocks
  if (Array.isArray(blocks)) return blocks.map((b) => b.text ?? (b.content ? inlineText(b.content) : (b.items ?? []).map((i) => inlineText(i.content)).join('\n'))).join('\n')
  if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) return v.join(', ')
  return undefined
}
