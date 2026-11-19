import {DIFF_DELETE, DIFF_INSERT, makeDiff} from '@sanity/diff-match-patch'

// Two editors changed one Portable Text block at once (a paste, a split, a join: anything
// that is not typing in a span, which goes as diff-match-patch). The save carries the field
// or the block whole, so the merge happens here: their words go into my blocks, as text.
// Keeping my block whole dropped theirs, and a paste that split the block (or put a new span
// key on it) left no span to line their typing up with (task-7777e1ba8c35d896).
//
// A block's text, for the merge, is its spans' text in order with one OBJ for each inline
// object. Base blocks one side joined (or deleted across) read as one text with a SEP
// between them, and so do the new blocks next to them on either side (a paste or Enter splits
// a block). Both sides' changes to that text are merged letter by letter (textMerge3); the
// result is cut back into blocks at each SEP and each letter goes back to the span it came from.

type Obj = Record<string, unknown>
export const SEP = ' '
export const OBJ = '￼'

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
export const isText = (b: unknown): b is Obj & {children: Obj[]} => isObj(b) && b._type === 'block' && Array.isArray(b.children) && b.children.every(isObj)
export const keyOf = (b: unknown): string | undefined => (isObj(b) && typeof b._key === 'string' ? b._key : undefined)
/** Equal as JSON values: key order and undefined keys aside (the editor writes keys in its own order). */
export const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]))
  if (!isObj(a) || !isObj(b)) return false
  const ka = Object.keys(a).filter((k) => a[k] !== undefined)
  return ka.length === Object.keys(b).filter((k) => b[k] !== undefined).length && ka.every((k) => same(a[k], b[k]))
}
const isSpan = (c: Obj) => c._type === 'span'
export const textOf = (b: Obj & {children: Obj[]}) => b.children.map((c) => (isSpan(c) ? String(c.text ?? '') : OBJ)).join('')

let fresh = () => Math.random().toString(16).slice(2, 14)
export const newKey = () => fresh()
/** Tests: keys made here are predictable. */
export const keysFrom = (make: () => string) => void (fresh = make)

/** One letter of the merge, as `mine` reads: kept (0), taken out (-1), or theirs added (1, `t` its place in theirs). */
export type Op = {op: -1 | 0 | 1; ch: string; t?: number}

/** One side's change to `base`: the text it puts before each base letter, and the base letters it takes out. */
function edits(base: string, side: string) {
  const ins = new Map<number, {text: string; at: number}>()
  const del = new Uint8Array(base.length)
  let p = 0
  let s = 0
  for (const [op, chunk] of makeDiff(base, side)) {
    if (op === DIFF_INSERT) {
      const was = ins.get(p)
      ins.set(p, {text: (was?.text ?? '') + chunk, at: was?.at ?? s})
      s += chunk.length
    } else if (op === DIFF_DELETE) {
      del.fill(1, p, p + chunk.length)
      p += chunk.length
    } else (p += chunk.length), (s += chunk.length)
  }
  return {ins, del}
}

/**
 * Three-way merge of two texts, letter by letter, the same text whichever side is `mine`:
 * every letter either side added is in it, a base letter either side took out is not, and
 * none is there twice. Two texts added at one place both go in, in an order that does not
 * depend on who saves first: a block break ending one goes first, one starting with a break
 * last, then one that replaced the letter before it, then by their letters. The same text
 * added at the same place by both counts once.
 */
export function textMerge3(base: string, mine: string, theirs: string): {text: string; ops: Op[]} {
  const m = edits(base, mine)
  const t = edits(base, theirs)
  const ops: Op[] = []
  const put = (op: Op['op'], s: string, at?: number) => {
    for (let i = 0; i < s.length; i++) ops.push(at === undefined ? {op, ch: s[i]!} : {op, ch: s[i]!, t: at + i})
  }
  const rank = (s: string, p: number, del: Uint8Array) => [s.endsWith(SEP) ? 0 : s.startsWith(SEP) ? 2 : 1, p > 0 && del[p - 1] ? 0 : 1] as const
  for (let p = 0; p <= base.length; p++) {
    const M = m.ins.get(p)
    const T = t.ins.get(p)
    if (M && T) {
      // The same text at the same place, once. Blocks of theirs this editor drew already (a run
      // of theirs inside mine, block breaks and all) count as the same text too.
      if (M.text === T.text || (T.text.includes(SEP) && M.text.includes(T.text))) put(0, M.text)
      else if (M.text.includes(SEP) && T.text.includes(M.text)) put(-1, M.text), put(1, T.text, T.at)
      else {
        const [a, b] = [rank(M.text, p, m.del), rank(T.text, p, t.del)]
        const mineFirst = a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : M.text < T.text
        if (mineFirst) put(0, M.text), put(1, T.text, T.at)
        else put(1, T.text, T.at), put(0, M.text)
      }
    } else if (M) put(0, M.text)
    else if (T) put(1, T.text, T.at)
    if (p < base.length && !m.del[p]) put(t.del[p] ? -1 : 0, base[p]!)
  }
  return {text: ops.filter((o) => o.op !== -1).map((o) => o.ch).join(''), ops}
}

type Run = {from: [block: number, child: number] | null; text: string; obj?: boolean}
type Segment = {who: Obj; runs: Run[]; theirs?: number}

/**
 * `mine` (the blocks of one run, as this editor has them) with the merge's `ops` done. Each
 * SEP of mine's text that stays starts mine's next block; one theirs added starts their
 * block it starts in `now` (their run's text). Nothing of mine is taken out but text.
 */
function cut(mine: (Obj & {children: Obj[]})[], ops: Op[], theirs: Obj[], now: string): Obj[] {
  // Who each letter of mine's text belongs to.
  const owner: ({block: number; child: number} | {sep: number})[] = []
  mine.forEach((b, i) => {
    if (i) owner.push({sep: i})
    b.children.forEach((c, j) => {
      const n = isSpan(c) ? String(c.text ?? '').length : 1
      for (let k = 0; k < n; k++) owner.push({block: i, child: j})
    })
  })
  // Which of their blocks each letter of `now` is in.
  const blockAt: number[] = []
  for (let i = 0, n = 0; i < now.length; i++) blockAt.push(now[i] === SEP ? ++n : n)
  const segments: Segment[] = [{who: mine[0]!, runs: []}]
  const add = (from: Run['from'], ch: string, obj = false) => {
    const runs = segments.at(-1)!.runs
    const last = runs.at(-1)
    if (!obj && last && !last.obj && (last.from === from || (last.from && from && last.from[0] === from[0] && last.from[1] === from[1]))) last.text += ch
    else runs.push({from, text: obj ? '' : ch, obj})
  }
  let pos = 0
  for (const {op, ch, t} of ops) {
    if (op === 1) {
      const j = blockAt[t!] ?? 0
      if (ch === SEP) segments.push({who: theirs[j] ?? {_type: 'block', style: 'normal', markDefs: []}, runs: [], theirs: j})
      else if (ch !== OBJ) add(null, ch)
      continue
    }
    const o = owner[pos++]!
    if ('sep' in o) op === 0 && segments.push({who: mine[o.sep]!, runs: []}) // a block break they took out (a join) goes
    else if (isSpan(mine[o.block]!.children[o.child]!)) op === DIFF_DELETE || add([o.block, o.child], ch)
    else add([o.block, o.child], ch, true) // an inline object stays
  }
  // Text of theirs alone, then a block break of theirs: their block before that one (a paste
  // that split it at its start), and mine's first block is the next one.
  const j = segments[1]?.theirs
  if (j && segments[0]!.runs.every((r) => !r.from) && theirs[j - 1]) segments[0]!.who = theirs[j - 1]!
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
 * Where a group of base blocks sits in `list`: from the first of them there to the last, then
 * on over the new text blocks next to it (a split's). Null when it is not one stretch there
 * (moved apart, something else between) or none of it is left.
 */
function stretch(list: unknown[], group: string[], inBase: Set<string>, taken: Set<string>, from_: Map<string, Set<string>>): [number, number] | null {
  const at = group.map((k) => list.findIndex((x) => keyOf(x) === k)).filter((i) => i >= 0)
  if (!at.length || at.some((i, n) => n > 0 && i <= at[n - 1]!)) return null
  let from = at[0]!
  let to = at.at(-1)!
  for (let i = from; i <= to; i++) {
    const k = keyOf(list[i]) ?? ''
    if (!isText(list[i]) || (!group.includes(k) && (inBase.has(k) || taken.has(k)))) return null
  }
  // A new block holding base letters is in the run of the block they came from.
  const free = (i: number) => isText(list[i]) && !inBase.has(keyOf(list[i]) ?? '') && !taken.has(keyOf(list[i]) ?? '') && [...(from_.get(keyOf(list[i]) ?? '') ?? [])].every((k) => group.includes(k))
  while (from > 0 && free(from - 1)) from--
  while (to < list.length - 1 && free(to + 1)) to++
  return [from, to]
}

/** A list's text: its blocks' text joined by SEP, one OBJ for anything not a text block. */
const field = (l: unknown[]) => l.map((x) => (isText(x) ? textOf(x) : OBJ)).join(SEP)

/** For each block of `side` (by key), the base blocks whose letters it holds. */
export function basedOn(base: unknown[], side: unknown[]): Map<string, Set<string>> {
  const b = field(base)
  const each = (l: unknown[]) => l.flatMap((x, i) => Array<string>((i ? 1 : 0) + field([x]).length).fill(keyOf(x) ?? ''))
  const owner = each(base)
  const at = each(side)
  const of = new Map<string, Set<string>>()
  let p = 0
  let s = 0
  for (const [op, chunk] of makeDiff(b, field(side))) {
    if (op === DIFF_INSERT) s += chunk.length
    else if (op === DIFF_DELETE) p += chunk.length
    else for (let k = 0; k < chunk.length; k++, p++, s++) if (b[p] !== SEP) of.set(at[s]!, (of.get(at[s]!) ?? new Set()).add(owner[p]!))
  }
  return of
}

/**
 * Their changes to the text blocks this editor changed too, put into `mine`. Base text blocks
 * next to each other go together when either side lacks one of them (a join, a delete across
 * blocks); a group both sides changed merges as one text (textMerge3), the new blocks around
 * it on either side with it. `consumed` names their new blocks whose text went in that way: a
 * list merge must not add them again; `own` the blocks such a merge made: a list merge takes
 * them as they are here, never their copy of the block.
 */
export function withTheirWords(base: unknown[], mine: unknown[], theirs: unknown[]): {mine: unknown[]; consumed: Set<string>; own: Set<string>} {
  const consumed = new Set<string>()
  const own = new Set<string>()
  const keys = (l: unknown[]) => new Set(l.map(keyOf).filter((k): k is string => !!k))
  const inBase = keys(base)
  const inMine = keys(mine)
  const inTheirs = keys(theirs)
  if (inMine.size !== mine.length || inTheirs.size !== theirs.length) return {mine, consumed, own}
  const baseBy = new Map(base.map((b) => [keyOf(b), b]))
  const order = new Map(base.map((b, i) => [keyOf(b), i]))
  // The block breaks of the base each side took out, read off the whole list's text (a join of
  // a block whose key went to another piece of a split shows only there).
  const breaks = (side: unknown[]) => {
    const del = edits(field(base), field(side)).del
    const out = new Set<number>()
    for (let i = 1, p = 0; i < base.length; i++) (p += field([base[i - 1]]).length), del[p] && out.add(i), p++
    return out
  }
  const gone = new Set([...breaks(mine), ...breaks(theirs)])
  const fromMine = basedOn(base, mine)
  const fromTheirs = basedOn(base, theirs)
  const groups: string[][] = []
  base.forEach((b, i) => {
    const k = keyOf(b)
    if (!k || !isText(b)) return
    const pk = i > 0 && isText(base[i - 1]) ? keyOf(base[i - 1]) : undefined
    const joined = pk && groups.at(-1)?.at(-1) === pk && (gone.has(i) || [pk, k].some((x) => !inMine.has(x) || !inTheirs.has(x)))
    if (joined) groups.at(-1)!.push(k)
    else groups.push([k])
  })
  let out = [...mine]
  const taken = new Set<string>()
  for (const group of groups) {
    const ms = stretch(out, group, inBase, taken, fromMine)
    const ts = stretch(theirs, group, inBase, taken, fromTheirs)
    if (!ms || !ts) continue
    const ours = out.slice(ms[0], ms[1] + 1) as (Obj & {children: Obj[]})[]
    const their = theirs.slice(ts[0], ts[1] + 1) as (Obj & {children: Obj[]})[]
    const was = group.map((k) => baseBy.get(k) as Obj & {children: Obj[]})
    // Only where both changed it (a block's text or its new blocks around it); a span's own text holding a SEP is not cut there.
    if (same(ours, was) || same(their, was) || same(ours, their) || [...ours, ...their, ...was].some((x) => textOf(x).includes(SEP))) continue
    const text = ours.map(textOf).join(SEP)
    const now = their.map(textOf).join(SEP)
    const merged = textMerge3(was.map(textOf).join(SEP), text, now)
    for (const x of their) if (!inBase.has(keyOf(x)!)) consumed.add(keyOf(x)!)
    for (const x of [...ours, ...their]) taken.add(keyOf(x)!)
    // A base block they removed, or one out of the base's order here, keeps no key of its own: the
    // list merge would drop it (words and all) or put it back in its old place.
    let last = -1
    const blocks = (merged.text === text && merged.ops.every((o) => o.op === 0) ? ours : cut(ours, merged.ops, their, now)).map((b) => {
      const at = order.get(keyOf(b))
      if (at === undefined) return b
      if (at > last && inTheirs.has(keyOf(b)!)) return (last = at), b
      return {...b, _key: fresh()}
    })
    for (const b of blocks) taken.add(keyOf(b)!), own.add(keyOf(b)!)
    out = [...out.slice(0, ms[0]), ...blocks, ...out.slice(ms[1] + 1)]
  }
  // A key twice (their block, drawn here before): the later one is new.
  const seen = new Set<string>()
  out = out.map((b) => (keyOf(b) && seen.has(keyOf(b)!) ? {...(b as Obj), _key: fresh()} : (seen.add(keyOf(b) ?? ''), b)))
  return {mine: out, consumed, own}
}

/** Whether a list holds Portable Text blocks (a list merge goes by withTheirWords then). */
export const hasTextBlocks = (list: unknown[]): boolean => list.some(isText)
