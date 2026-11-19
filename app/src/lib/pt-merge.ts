import {applyPatches, DIFF_DELETE, DIFF_INSERT, makeDiff, makePatches} from '@sanity/diff-match-patch'

// Two editors changed one Portable Text block at once (a paste, a split, a join: anything
// that is not typing in a span, which goes as diff-match-patch). The save carries the field
// or the block whole, so the merge happens here: their words go into my blocks, as text.
// Keeping my block whole dropped theirs, and a paste that split the block (or put a new span
// key on it) left no span to line their typing up with (task-7777e1ba8c35d896).
//
// A block's text, for the merge, is its spans' text in order with one OBJ for each inline
// object. The blocks this editor made out of it (the block, and the new ones next to it: a
// paste or Enter splits a block) read as one text, a SEP between blocks. Their change to the
// block (with the new blocks next to it on their side) is diff-match-patch from the block's
// text before, put onto that text; the result is cut back into blocks at each SEP and each
// letter goes back to the span it came from. A letter they added joins the span beside it.

type Obj = Record<string, unknown>
const SEP = ' '
const OBJ = '￼'

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const isText = (b: unknown): b is Obj & {children: Obj[]} => isObj(b) && b._type === 'block' && Array.isArray(b.children) && b.children.every(isObj)
const keyOf = (b: unknown): string | undefined => (isObj(b) && typeof b._key === 'string' ? b._key : undefined)
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]))
  if (!isObj(a) || !isObj(b)) return false
  const ka = Object.keys(a).filter((k) => a[k] !== undefined)
  return ka.length === Object.keys(b).filter((k) => b[k] !== undefined).length && ka.every((k) => same(a[k], b[k]))
}
const isSpan = (c: Obj) => c._type === 'span'
const textOf = (b: Obj & {children: Obj[]}) => b.children.map((c) => (isSpan(c) ? String(c.text ?? '') : OBJ)).join('')

let fresh = () => Math.random().toString(16).slice(2, 14)
/** Tests: keys made here are predictable. */
export const keysFrom = (make: () => string) => void (fresh = make)

/**
 * Where `list[at]` and the text blocks next to it that no one else has (keys not in `others`)
 * start and end: the blocks one editor made out of one block.
 */
function run(list: unknown[], at: number, others: Set<string>): [number, number] {
  const own = (i: number) => isText(list[i]) && !others.has(keyOf(list[i]) ?? '')
  let from = at
  let to = at
  while (from > 0 && own(from - 1)) from--
  while (to < list.length - 1 && own(to + 1)) to++
  return [from, to]
}

/** Patches base → theirs onto text: null when a hunk finds no place (the text it changes is gone). */
function put(base: string, theirs: string, text: string): string | null {
  if (theirs === base) return text
  if (text === base) return theirs
  const patches = makePatches(base, theirs)
  // Already in (this editor has drawn their change): taken out and put back it gives the same text.
  const [without, out] = applyPatches(makePatches(theirs, base), text, {allowExceedingIndices: true})
  if (without !== text && out.every(Boolean) && applyPatches(patches, without, {allowExceedingIndices: true})[0] === text) return text
  const [merged, applied] = applyPatches(patches, text, {allowExceedingIndices: true})
  return applied.every(Boolean) ? merged : null
}

type Run = {from: [block: number, child: number] | null; text: string; obj?: boolean}
type Segment = {who: Obj; runs: Run[]; theirs?: boolean}

/**
 * `mine` (the blocks of one run, as this editor has them) with the text changed to `merged`.
 * Each SEP that was in mine's text starts mine's next block; the n-th one that came with
 * theirs starts their run's block n+1 (the one after it there). Nothing of mine is taken out but text.
 */
function cut(mine: (Obj & {children: Obj[]})[], text: string, merged: string, theirs: Obj[]): Obj[] {
  // Who each letter of mine's text belongs to.
  const owner: ({block: number; child: number} | {sep: number})[] = []
  mine.forEach((b, i) => {
    if (i) owner.push({sep: i})
    b.children.forEach((c, j) => {
      const n = isSpan(c) ? String(c.text ?? '').length : 1
      for (let k = 0; k < n; k++) owner.push({block: i, child: j})
    })
  })
  const segments: Segment[] = [{who: mine[0]!, runs: []}]
  let theirSep = 0
  const add = (from: Run['from'], ch: string, obj = false) => {
    const runs = segments.at(-1)!.runs
    const last = runs.at(-1)
    if (!obj && last && !last.obj && (last.from === from || (last.from && from && last.from[0] === from[0] && last.from[1] === from[1]))) last.text += ch
    else runs.push({from, text: obj ? '' : ch, obj})
  }
  let pos = 0
  for (const [op, chunk] of makeDiff(text, merged)) {
    for (const ch of chunk) {
      if (op === DIFF_INSERT) {
        if (ch === SEP) segments.push({who: theirs[++theirSep] ?? {_type: 'block', style: 'normal', markDefs: []}, runs: [], theirs: true})
        else if (ch !== OBJ) add(null, ch)
        continue
      }
      const o = owner[pos++]!
      if ('sep' in o) segments.push({who: mine[o.sep]!, runs: []}) // a block boundary of mine stays, whatever they did
      else if (isSpan(mine[o.block]!.children[o.child]!)) op === DIFF_DELETE || add([o.block, o.child], ch)
      else add([o.block, o.child], ch, true) // an inline object stays
    }
  }
  // Text of theirs alone, then a block break of theirs: their block before the one they share
  // with mine (a paste that split it at its start), and mine's first block is the next one.
  if (segments[1]?.theirs && segments[0]!.runs.every((r) => !r.from) && theirs[0]) segments[0]!.who = theirs[0]
  const used = new Set<string>()
  return segments.map(({who, runs}) => {
    // A letter of theirs joins the span before it in the block, else the one after it.
    const span = (r: Run) => !!r.from && !r.obj
    runs.forEach((r, i) => {
      if (r.from) return
      const before = runs.slice(0, i).reverse().find(span)
      const host = before ?? runs.slice(i + 1).find(span)
      if (host) (host.text = before ? host.text + r.text : r.text + host.text), (r.text = '')
    })
    const text = runs.map((r) => (r.obj ? OBJ : r.text)).join('')
    // No letter of mine in it: their block as they have it, when it says just that.
    const like = runs.every((r) => !r.from) ? ([who, ...theirs, ...mine].find((b) => isText(b) && keyOf(b) === keyOf(who) && textOf(b) === text) as (Obj & {children: Obj[]}) | undefined) : undefined
    const keys = new Set<string>()
    const children = like
      ? like.children
      : runs.flatMap((r): Obj[] => {
          if (!r.from) return r.text ? [{_type: 'span', _key: fresh(), text: r.text, marks: []}] : []
          const c = mine[r.from[0]]!.children[r.from[1]]!
          if (r.obj) return [c]
          const k = keyOf(c) && !keys.has(keyOf(c)!) ? keyOf(c)! : fresh()
          keys.add(k)
          return [{...c, _key: k, text: r.text}]
        })
    if (!children.length) children.push({_type: 'span', _key: fresh(), text: '', marks: []})
    // Marks on a span that moved here name its block's markDefs: they come with it.
    const defs = new Map<string, unknown>()
    for (const b of [who, ...runs.filter((r) => r.from).map((r) => mine[r.from![0]]!)]) for (const d of Array.isArray(b.markDefs) ? b.markDefs : []) if (keyOf(d) && !defs.has(keyOf(d)!)) defs.set(keyOf(d)!, d)
    const marks = new Set(children.flatMap((c) => (Array.isArray(c.marks) ? c.marks : [])))
    const own = new Set((Array.isArray(who.markDefs) ? who.markDefs : []).map(keyOf))
    const markDefs = [...defs].filter(([k]) => own.has(k) || marks.has(k)).map(([, d]) => d)
    const key = keyOf(who) && !used.has(keyOf(who)!) ? keyOf(who)! : fresh()
    used.add(key)
    return {...who, _key: key, children, ...(markDefs.length || 'markDefs' in who ? {markDefs} : {})}
  })
}

/**
 * Their changes to the text blocks this editor changed too, put into `mine`: each block
 * `base` has, `mine` changed and `theirs` changed (as text), with the new blocks around it on
 * either side. `consumed` names their new blocks whose text went in that way: a list merge
 * must not add them again. Text no place can be found for in mine (they rewrote what mine
 * moved or removed) is added at the end of that run, as mergeText does: never dropped.
 */
export function withTheirWords(base: unknown[], mine: unknown[], theirs: unknown[]): {mine: unknown[]; consumed: Set<string>} {
  const consumed = new Set<string>()
  const keys = (l: unknown[]) => new Set(l.map(keyOf).filter((k): k is string => !!k))
  const inBase = keys(base)
  const inMine = keys(mine)
  const inTheirs = keys(theirs)
  if (inMine.size !== mine.length || inTheirs.size !== theirs.length) return {mine, consumed}
  let out = [...mine]
  for (const b of base) {
    const k = keyOf(b)
    const t = theirs.findIndex((x) => keyOf(x) === k)
    const m = out.findIndex((x) => keyOf(x) === k)
    if (!k || !isText(b) || t < 0 || m < 0 || !isText(theirs[t]) || !isText(out[m]) || same(out[m], b) || same(theirs[t], b) || same(out[m], theirs[t])) continue
    const [mf, mt] = run(out, m, new Set([...inBase, ...inTheirs].filter((x) => x !== k)))
    const [tf, tt] = run(theirs, t, new Set([...inBase, ...inMine].filter((x) => x !== k)))
    const ours = out.slice(mf, mt + 1) as (Obj & {children: Obj[]})[]
    const their = theirs.slice(tf, tt + 1) as (Obj & {children: Obj[]})[]
    const text = ours.map(textOf).join(SEP)
    const was = textOf(b)
    const now = their.map(textOf).join(SEP)
    if ([...ours, ...their, b].some((x) => textOf(x).includes(SEP))) continue // a span's own text holds one: not cut there
    let merged = put(was, now, text)
    if (merged === null) {
      // No place for some of theirs (mine rewrote or moved the text they changed): what they
      // added goes at the end of mine's run, in their blocks. Each insert of theirs already in
      // mine's text (this merge, come back with their next frame) is not added again: it settles.
      const added = makeDiff(was, now).filter(([op]) => op === DIFF_INSERT).map(([, s]) => s).filter((s) => !text.includes(s.trim())).join(' ')
      const words = added.split(SEP).map((s) => s.trim().replace(/\s+/g, ' '))
      merged = text + (words[0] ? ` ${words[0]}` : '') + words.slice(1).map((w) => SEP + w).join('')
    }
    if (merged === text) continue
    const blocks = cut(ours, text, merged, their)
    for (const x of their) if (keyOf(x) !== k) consumed.add(keyOf(x)!)
    out = [...out.slice(0, mf), ...blocks, ...out.slice(mt + 1)]
    for (const x of blocks) inMine.add(keyOf(x)!)
  }
  return {mine: out, consumed}
}

/** One block both editors changed, merged as text (withTheirWords); null when it is not a text block. */
export function mergeBlock(base: unknown, mine: unknown, theirs: unknown): unknown {
  if (!isText(base) || !isText(mine) || !isText(theirs)) return null
  return withTheirWords([base], [mine], [theirs]).mine[0] ?? mine
}

/** Whether a list holds Portable Text blocks (a list merge goes by withTheirWords then). */
export const hasTextBlocks = (list: unknown[]): boolean => list.some(isText)
