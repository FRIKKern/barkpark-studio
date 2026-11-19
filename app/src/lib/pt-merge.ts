import {DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT, makeDiff} from '@sanity/diff-match-patch'

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
/**
 * A diff that reads a block break moved past letters as those letters taken out on one side of
 * it and typed again on the other (`op|q` → `o|pq`: p out, p in; a paste that joined a piece
 * of the next block onto this one) says it as the break moving: the letters stay the base's,
 * so the other side's deletion of them still holds.
 */
function breaksMoved(diffs: [number, string][], base: string, side: string, keys?: Keys): [number, string][] {
  const out = diffs.map((d) => [...d] as [number, string])
  const brk = (t: string) => !!t && [...t].every((c) => c === SEP)
  for (let i = 0; i + 2 < out.length; i++) {
    const [a, x] = out[i]!
    const [eq, gap] = out[i + 1]!
    const [b, y] = out[i + 2]!
    if (eq !== DIFF_EQUAL || !brk(gap)) continue
    // Letters typed before the break that the base had after it: base `gap y`.
    const fix: [number, string][] | null =
      a === DIFF_INSERT && b === DIFF_DELETE && y && x.startsWith(y) ? [[DIFF_DELETE, gap], [DIFF_EQUAL, y], [DIFF_INSERT, x.slice(y.length) + gap]]
      : a === DIFF_INSERT && b === DIFF_DELETE && y && x.endsWith(y) ? [[DIFF_DELETE, gap], [DIFF_INSERT, x.slice(0, -y.length)], [DIFF_EQUAL, y], [DIFF_INSERT, gap]]
      // Letters typed after the break that the base had before it: base `x gap`.
      : a === DIFF_DELETE && b === DIFF_INSERT && x && y.startsWith(x) ? [[DIFF_INSERT, gap], [DIFF_EQUAL, x], [DIFF_DELETE, gap], [DIFF_INSERT, y.slice(x.length)]]
      : a === DIFF_DELETE && b === DIFF_INSERT && x && y.endsWith(x) ? [[DIFF_INSERT, gap + y.slice(0, -x.length)], [DIFF_EQUAL, x], [DIFF_DELETE, gap]]
      : null
    if (fix) out.splice(i, 3, ...fix.filter(([, t]) => t))
  }
  return testOnly.farMoves ? farMoves(out, base, side, keys) : out
}

/** Tests only (pt-moved-letters.test.ts holds that no product file uses it): with `farMoves` false the diff reads as before task-39ac4770a54b587a. */
export const testOnly = {farMoves: true}

/** Each text's blocks' keys, in order (one per SEP-cut piece): the base's, then the side's. */
export type Keys = [base: (string | undefined)[], side: (string | undefined)[]]

/**
 * The same, with more changed around the break (task-39ac4770a54b587a): the other deleted the
 * break and pasted paragraphs or split there. Letters taken out before the break and put in
 * again in what is typed after it (`p|q` → `x|p`: p out, x in; q out, p in), or typed before it
 * and taken out after it, are the base's letters with the break moved past them, but only when
 * the block keys say so: each letter is in its own base block on that side. Anywhere else (a new
 * block, its base block there or gone; no keys) the merge cannot tell a moved letter from a new
 * one, and the letter is kept: read as typed. `a|` → `|bb|a` is "a" typed after a paste over it,
 * and the same as a paste before "a" that moved it (a split); both read as typed.
 */
function farMoves(diffs: [number, string][], base: string, to: string, keys?: Keys): [number, string][] {
  const out = diffs.map((d) => [...d] as [number, string])
  const brk = (t: string) => !!t && [...t].every((c) => c === SEP)
  // Where entry `j` starts: [in base, in side].
  const at = (j: number) => {
    let p = 0
    let s = 0
    for (let x = 0; x < j; x++) (out[x]![0] !== DIFF_INSERT && (p += out[x]![1].length), out[x]![0] !== DIFF_DELETE && (s += out[x]![1].length))
    return [p, s] as const
  }
  const piece = (t: string, pos: number) => [...t.slice(0, pos)].filter((c) => c === SEP).length
  // The n letters at `p` in the base and `s` in the side: the same letters, moved.
  const moved = (p: number, s: number, n: number) =>
    !!keys &&
    Array.from({length: n}, (_, j) => j).every((j) => {
      if (base[p + j] === SEP) return true
      const was = keys[0][piece(base, p + j)]
      return !!was && keys[1][piece(to, s + j)] === was
    })
  // The changes next to index `at` on one side (up to a deletion and an insertion), and where they span.
  const side = (from: number, step: 1 | -1) => {
    let del = ''
    let ins = ''
    let n = 0
    for (let j = from; j >= 0 && j < out.length && n < 2 && out[j]![0] !== DIFF_EQUAL; j += step, n++) {
      const [op, t] = out[j]!
      if (op === DIFF_DELETE && !del) del = t
      else if (op === DIFF_INSERT && !ins) ins = t
      else break
    }
    return {del, ins, n}
  }
  for (let i = 1; i + 1 < out.length; i++) {
    const [eq, gap] = out[i]!
    if (eq !== DIFF_EQUAL || !brk(gap)) continue
    const pre = side(i - 1, -1)
    const post = side(i + 1, 1)
    if (!pre.n || !post.n) continue
    let fix: [number, string][] | null = null
    // Taken out before the break, in what is typed after it.
    const k = pre.del ? post.ins.indexOf(pre.del) : -1
    if (k >= 0 && moved(at(i - pre.n)[0], at(i + 1)[1] + k, pre.del.length)) fix = [[DIFF_INSERT, pre.ins + gap + post.ins.slice(0, k)], [DIFF_EQUAL, pre.del], [DIFF_DELETE, gap + post.del], [DIFF_INSERT, post.ins.slice(k + pre.del.length)]]
    // Typed before the break, in what is taken out after it.
    const h = pre.ins ? post.del.indexOf(pre.ins) : -1
    if (!fix && h >= 0 && moved(at(i + 1)[0] + h, at(i - pre.n)[1], pre.ins.length)) fix = [[DIFF_DELETE, pre.del + gap + post.del.slice(0, h)], [DIFF_EQUAL, pre.ins], [DIFF_DELETE, post.del.slice(h + pre.ins.length)], [DIFF_INSERT, gap + post.ins]]
    if (fix) out.splice(i - pre.n, pre.n + 1 + post.n, ...fix.filter(([, t]) => t))
  }
  return out
}
/** `base` → `side` letter by letter (a raw diff: no semantic clean-up), a moved block break read as one. */
export const diff = (base: string, side: string, keys?: Keys) => breaksMoved(makeDiff(base, side), base, side, keys)

function edits(base: string, side: string, keys?: Keys) {
  const ins = new Map<number, {text: string; at: number}>()
  const del = new Uint8Array(base.length)
  let p = 0
  let s = 0
  for (const [op, chunk] of diff(base, side, keys)) {
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
export function textMerge3(base: string, mine: string, theirs: string, keys?: {base: Keys[0]; mine: Keys[1]; theirs: Keys[1]}): {text: string; ops: Op[]} {
  const m = edits(base, mine, keys && [keys.base, keys.mine])
  const t = edits(base, theirs, keys && [keys.base, keys.theirs])
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
  // Span keys are unique across the field: a span of mine whose letters went to two blocks (a
  // split of theirs) keeps its key in the first; in the next it takes that block's own span key
  // (their block as they have it), else a new one. Twice in one field, the editor holding their
  // block took the second for another block and stored its text twice (task-30946f2255a30d93).
  const spanKeys = new Set<string>()
  const out = segments.map(({who, runs}) => {
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
    const theirsSpans = (Array.isArray(who.children) ? (who.children as Obj[]) : []).filter((c) => isSpan(c) && keyOf(c)).map((c) => keyOf(c)!)
    const children = like
      ? like.children
      : runs.flatMap((r): Obj[] => {
          if (!r.from) return r.text ? [{_type: 'span', _key: fresh(), text: r.text, marks: []}] : []
          const c = mine[r.from[0]]!.children[r.from[1]]!
          if (r.obj) return [c]
          const k = keyOf(c) && !spanKeys.has(keyOf(c)!) ? keyOf(c)! : (theirsSpans.find((t) => !spanKeys.has(t)) ?? fresh())
          spanKeys.add(k)
          return [{...c, _key: k, text: r.text}]
        })
    for (const c of children) if (keyOf(c)) spanKeys.add(keyOf(c)!)
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
  // A block taken as they have it may carry a span key mine used before it: that one goes new.
  const seen = new Set<string>()
  return out.map((b) => {
    const children = b.children.map((c) => (!keyOf(c) ? c : seen.has(keyOf(c)!) ? {...c, _key: fresh()} : (seen.add(keyOf(c)!), c)))
    return children.every((c, i) => c === b.children[i]) ? b : {...b, children}
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
  for (const [op, chunk] of diff(b, field(side), [base.map(keyOf), side.map(keyOf)])) {
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
    const del = edits(field(base), field(side), [base.map(keyOf), side.map(keyOf)]).del
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
    const merged = textMerge3(was.map(textOf).join(SEP), text, now, {base: group, mine: ours.map(keyOf), theirs: their.map(keyOf)})
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
    // A block's style or list place they changed and I did not: theirs (a heading set while I pasted).
    for (const [i, b] of blocks.entries()) {
      const [was, m, t] = [baseBy.get(keyOf(b)), ours.find((x) => keyOf(x) === keyOf(b)), their.find((x) => keyOf(x) === keyOf(b))]
      if (isObj(was) && m && t) for (const f of ['style', 'listItem', 'level']) if (same(m[f], was[f]) && !same(t[f], was[f])) blocks[i] = {...(blocks[i] as Obj), [f]: t[f]}
    }
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
