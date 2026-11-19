import {mergeList3} from './merge.ts'
import {getPath, setPath} from './paths.ts'
import {SPAN_TEXT} from './pt-dmp.ts'

// The span-text save (typing in a Portable Text span, sent as diff-match-patch: lib/pt-dmp.ts)
// ends in the same merge exit as every other rich-text save (task-30946f2255a30d93,
// task-ab6d751fa53fbda5): the field as this editor means it, merged as blocks from what it was
// typed on (lib/merge.ts mergeList3: the blocks as text, then the net, lib/pt-keep.ts).
//
// Barkpark merges a span patch into the span's text as it is there. When the other editor's
// paste split the block meanwhile, the span holds a piece of the text it had: a hunk lands on
// the wrong letters (one of the paste's), or on none (a deletion comes back, a word goes to
// the end). The answer is then put right from the field as it was just before the patch.

/** The field a span path is in (`body` for `body[_key=="b"].children[_key=="s"].text`), and the path inside it. */
export function spanRoot(path: string): {root: string; inner: string} | null {
  const at = path.indexOf('[')
  return SPAN_TEXT.test(path) && at > 0 && !path.slice(0, at).includes('.') ? {root: path.slice(0, at), inner: path.slice(at)} : null
}

/**
 * This editor's span texts merged onto `theirs`, the field as the server has it (or had it,
 * just before this editor's patch). `field`: the field as this editor had it when it typed;
 * `spans`: each span's path inside it, the text it was typed from, and the text typed. Null
 * when the field is not a list or a span is not in `field` (nothing to merge from).
 */
export function spansOnto(field: unknown, spans: [inner: string, from: string, mine: string][], theirs: unknown): unknown[] | null {
  if (!Array.isArray(field) || !Array.isArray(theirs)) return null
  let base: unknown = field
  let mine: unknown = field
  for (const [inner, from, text] of spans) {
    if (typeof getPath({v: field}, `v${inner}`) !== 'string') return null
    const at = (v: unknown, t: string) => setPath({v}, `v${inner}`, t).v
    base = at(base, from)
    mine = at(mine, text)
  }
  return mergeList3(base as unknown[], mine as unknown[], theirs)
}

/**
 * What a span patch's answer needs (`saved`: the field as Barkpark answered), from the field as
 * it was just before the patch (`before`) and what this editor meant (`spansOnto`'s arguments):
 * the merged field to send, or null when the answer is it already. Never judged by the letters
 * alone: a hunk that landed in the wrong block of a split keeps every letter.
 */
export function spanAnswer(field: unknown, spans: [inner: string, from: string, mine: string][], before: unknown, saved: unknown): unknown[] | null {
  const merged = spansOnto(field, spans, before)
  return !merged || JSON.stringify(merged) === JSON.stringify(saved) ? null : merged
}
