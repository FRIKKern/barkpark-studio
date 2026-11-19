import {mergeList3} from './merge.ts'
import {applyPatches, makePatches} from '@sanity/diff-match-patch'
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
 * alone: a hunk that landed in the wrong block of a split keeps every letter. A span typed in
 * since that is not in `field` is in a block the other editor's frame brought (the tail of a
 * split): typed on `before`, it goes onto the merged field from there.
 */
export function spanAnswer(field: unknown, spans: Typed[], before: unknown, saved: unknown): unknown[] | null {
  const there = (v: unknown) => ([inner]: Typed) => typeof getPath({v}, `v${inner}`) === 'string'
  const typed = spans.filter(there(field))
  const asSent = typed.flatMap(([inner, from, , sent]): [string, string, string][] => (sent === undefined ? [] : [[inner, from, sent]]))
  // `before` is the text the patch landed on only if the patch, applied to it here, gives the
  // answer: else it is another revision (one between not listed), and merged from it the
  // other editor's words since were taken out again.
  const landed = asSent.reduce<unknown>((v, [inner, from, sent]) => {
    const was = getPath({v}, `v${inner}`)
    return typeof was === 'string' ? setPath({v}, `v${inner}`, applyPatches(makePatches(from, sent), was, {allowExceedingIndices: true})[0]).v : v
  }, before)
  if (!sameText(landed, saved)) return null
  // Judged by what was sent: right for that, the keys typed since go onto it span by span
  // (settleDmp), as when no block came or went. Put right whole with them in, the span came
  // back cut where the merge met their words, under this editor's caret, and its next keys
  // went into the wrong piece (two typing in one span lost words).
  const right = spansOnto(field, asSent, before)
  if (!right || sameLetters(right, saved)) return null
  const merged = spansOnto(field, typed.map(([inner, from, mine]) => [inner, from, mine]), before)
  if (!merged) return null
  const since = spans.filter((s) => !there(field)(s)).map(([inner, from, mine]): [string, string, string] => [inner, from, mine])
  return since.length ? spansOnto(before, since, merged) : merged
}

type Run = {_key?: string; _type?: string; text?: unknown; marks?: unknown}
/** A field's blocks as read: span keys left out and spans of the same marks run together. */
const read = (v: unknown) =>
  JSON.stringify(
    Array.isArray(v)
      ? v.map((b) => {
          const {children, ...rest} = (b ?? {}) as {children?: Run[]}
          if (!Array.isArray(children)) return b
          const runs: Run[] = []
          for (const {_key, ...c} of children) {
            const last = runs.at(-1)
            if (last && c._type === 'span' && last._type === 'span' && JSON.stringify(last.marks ?? []) === JSON.stringify(c.marks ?? [])) last.text = `${last.text}${c.text}`
            else runs.push({...c})
          }
          return {...rest, children: runs}
        })
      : v,
  )
/** The same blocks and text, however the spans are cut or keyed. */
const sameText = (a: unknown, b: unknown) => read(a) === read(b)
/**
 * The same blocks, each with the same letters (their order inside a block aside): where two
 * typed at one spot, Barkpark's patch and the merge may order the words differently, and
 * both are right. A word lost, doubled or in another block is not this.
 */
const sameLetters = (a: unknown, b: unknown) => {
  const letters = (v: unknown) =>
    JSON.stringify(Array.isArray(v) ? v.map((x) => {
      const {children, ...rest} = (x ?? {}) as {children?: Run[]}
      return Array.isArray(children) ? {...rest, text: [...children.map((c) => (typeof c.text === 'string' ? c.text : '')).join('')].sort().join('')} : x
    }) : v)
  return letters(a) === letters(b)
}

/** A span typed: its path inside the field, the text it was typed from, the text now, and the text sent (if it went). */
export type Typed = [inner: string, from: string, mine: string, sent?: string]

const keysOf = (v: unknown) => (Array.isArray(v) ? v.map((b) => (b as {_key?: unknown})?._key) : null)

/** The field's blocks, by key, are not the same list in `was` and `now` (one added, removed or moved). */
export function blocksMoved(was: unknown, now: unknown) {
  const a = keysOf(was)
  const b = keysOf(now)
  return !!a && !!b && JSON.stringify(a) !== JSON.stringify(b)
}

/**
 * A frame from the server under spans typed and not yet sent (`dirty`: path → text, `base`:
 * path → what each was typed on), when the other editor's change added or removed blocks of
 * the field (a paste that split the block): the field merged whole, from `field` (as the
 * server had it before) onto `theirs`. Merged span by span, the text alone, the words typed at
 * the end of a split block stayed in its first piece. Null: no blocks came or went (span by
 * span it is), or nothing to merge from.
 */
export function spansLifted(field: unknown, theirs: unknown, spans: [inner: string, from: string, mine: string][]): unknown[] | null {
  return blocksMoved(field, theirs) ? spansOnto(field, spans, theirs) : null
}
