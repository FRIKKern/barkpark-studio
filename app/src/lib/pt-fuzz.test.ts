// Two editors change one rich-text field at once, every way a paste goes (task-7777e1ba8c35d896):
// random pairs of edits (typing, a paste, a paste over a selection, Enter, a paragraph paste,
// a join, a delete) from one base, each merged with either saving second. Seeded: the same
// cases each run. Base letters are a-x; one side adds capitals, the other Greek, so each
// letter tells where it came from. node --test.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mergeList3} from './merge.ts'
import {caught} from './pt-keep.ts'
import {freshItems} from './pt-value.ts'
import {spanAnswer} from './pt-span.ts'
import {applyPatches, makePatches} from '@sanity/diff-match-patch'

type B = {key: string; span: string; text: string}
const SEED = Number(process.env.FUZZ_SEED ?? 1297)
const CASES = Number(process.env.FUZZ_CASES ?? 3000)
const BASE: B[] = [
  {key: 'b0', span: 'b0s', text: 'abcdefgh'},
  {key: 'b1', span: 'b1s', text: 'ijklmnop'},
  {key: 'b2', span: 'b2s', text: 'qrstuvwx'},
]
const KINDS = ['type', 'paste', 'pasteOver', 'split', 'pasteParagraphs', 'join', 'delete'] as const

function prng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pt = (bs: B[]) => bs.map((b) => ({_type: 'block', _key: b.key, style: 'normal', markDefs: [], children: [{_type: 'span', _key: b.span, text: b.text, marks: []}]}))
const texts = (v: unknown) => (v as {children: {text?: string}[]}[]).map((b) => b.children.map((c) => c.text ?? '').join(''))

/** One editor's edits on the base: what its browser would save. */
function edit(rnd: () => number, letters: string, side: string): {blocks: B[]; did: string[]} {
  const bs = BASE.map((b) => ({...b}))
  const pool = [...letters]
  let n = 0
  const key = () => `${side}-${++n}`
  const int = (k: number) => Math.floor(rnd() * k)
  const take = (k: number) => pool.splice(0, k).join('')
  const word = () => {
    const w = take(2 + int(3))
    return rnd() < 0.3 ? `${w.slice(0, 1)} ${w.slice(1)}` : w
  }
  const did: string[] = []
  for (let o = 0, ops = rnd() < 0.4 ? 2 : 1; o < ops; o++) {
    const kind = KINDS[int(KINDS.length)]!
    const i = int(bs.length)
    const b = bs[i]!
    const at = int(b.text.length + 1)
    did.push(`${kind}@${b.key}:${at}`)
    if (kind === 'type') b.text = b.text.slice(0, at) + take(1 + int(2)) + b.text.slice(at)
    else if (kind === 'paste') {
      if (rnd() < 0.3) b.span = key()
      b.text = b.text.slice(0, at) + word() + b.text.slice(at)
    } else if (kind === 'pasteOver' || kind === 'delete') {
      // To a place later in this block, or in the next one (the blocks between go).
      const j = i + 1 < bs.length && rnd() < 0.4 ? i + 1 : i
      const to = j === i ? at + int(b.text.length - at + 1) : int(bs[j]!.text.length + 1)
      b.text = b.text.slice(0, at) + (kind === 'pasteOver' ? word() : '') + bs[j]!.text.slice(to)
      bs.splice(i + 1, j - i)
    } else if (kind === 'split') {
      bs.splice(i + 1, 0, {key: key(), span: key(), text: b.text.slice(at)})
      b.text = b.text.slice(0, at)
    } else if (kind === 'pasteParagraphs') {
      const parts = Array.from({length: 2 + int(2)}, word)
      const pieces = parts.map((p, k) => (k === 0 ? b.text.slice(0, at) : '') + p + (k === parts.length - 1 ? b.text.slice(at) : ''))
      // The block's key stays on its first piece (Enter), or on its last (a paste at its start).
      const keep = rnd() < 0.5 ? 0 : pieces.length - 1
      bs.splice(i, 1, ...pieces.map((text, k) => (k === keep ? {...b, text} : {key: key(), span: key(), text})))
    } else if (kind === 'join' && i > 0) {
      bs[i - 1]!.text += b.text
      bs.splice(i, 1)
    }
  }
  return {blocks: bs, did}
}

const count = (s: string, ch: string) => s.split(ch).length - 1

/** Span keys used more than once in a field (an editor holding it reads one as another block's). */
const spanKeysTwice = (v: unknown) => {
  const keys = (v as {children?: {_key?: string}[]}[]).flatMap((b) => (b.children ?? []).map((c) => c._key))
  return keys.filter((k, i) => k && keys.indexOf(k) !== i)
}

test(`seeded fuzz (seed ${SEED}, ${CASES} pairs): either save order stores the same text, every added letter once, no base letter twice, each span key once`, () => {
  const rnd = prng(SEED)
  const fails: string[] = []
  const tally = {a: 0, b: 0, c: 0, kept: 0, keys: 0}
  const net = caught.count
  for (let n = 0; n < CASES; n++) {
    const A = edit(rnd, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'a')
    const Bv = edit(rnd, 'αβγδεζηθικλμνξοπρστυφχψω', 'b')
    const base = pt(BASE)
    const [a, b] = [pt(A.blocks), pt(Bv.blocks)]
    const at = (A.blocks.map((x) => x.text).join('') + Bv.blocks.map((x) => x.text).join('')).replace(/ /g, '')
    const added = [...new Set([...at].filter((ch) => !/[a-x]/.test(ch)))]
    const baseLetters = [...BASE.map((x) => x.text).join('')]
    const keptByBoth = baseLetters.filter((ch) => A.blocks.some((x) => x.text.includes(ch)) && Bv.blocks.some((x) => x.text.includes(ch)))
    for (const [name, merge] of [['mergeList3', mergeList3], ['freshItems', freshItems]] as const) {
      const [one, two] = [merge(base, a, b), merge(base, b, a)] // B saved first, A merges onto it; then the other way
      const [first, second] = [texts(one), texts(two)]
      const why: string[] = []
      const dup = [...spanKeysTwice(one), ...spanKeysTwice(two)]
      if (dup.length) tally.keys++, why.push(`span key twice ${dup.join(',')}`)
      if (JSON.stringify(first) !== JSON.stringify(second)) tally.a++, why.push('(a) orders differ')
      const all = [first.join('|'), second.join('|')]
      const lost = added.filter((ch) => all.some((t) => count(t, ch) === 0))
      const twice = [...added, ...baseLetters].filter((ch) => all.some((t) => count(t, ch) > 1))
      const gone = keptByBoth.filter((ch) => all.some((t) => count(t, ch) === 0))
      if (lost.length) tally.b++, why.push(`(b) lost ${lost.join('')}`)
      if (twice.length) tally.c++, why.push(`(c) twice ${twice.join('')}`)
      if (gone.length) tally.kept++, why.push(`base kept by both gone ${gone.join('')}`)
      if (why.length && fails.length < 8) fails.push(`#${n} ${name} A ${A.did.join(',')} ${JSON.stringify(texts(a))} B ${Bv.did.join(',')} ${JSON.stringify(texts(b))} -> ${JSON.stringify(first)} / ${JSON.stringify(second)}: ${why.join('; ')}`)
    }
  }
  const report = `fails ${JSON.stringify(tally)}, net added words ${caught.count - net} times\n${fails.join('\n')}`
  if (process.env.FUZZ_LOG) console.log(report)
  assert.deepEqual(tally, {a: 0, b: 0, c: 0, kept: 0, keys: 0}, report)
})

/** Typing in one span only: what this editor's span-text save sends (a diff-match-patch). */
function typeInSpan(rnd: () => number): {i: number; text: string; did: string} {
  const int = (k: number) => Math.floor(rnd() * k)
  const i = int(BASE.length)
  let text = BASE[i]!.text
  const pool = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']
  const did: string[] = []
  for (let o = 0, ops = 1 + int(2); o < ops; o++) {
    const at = int(text.length + 1)
    if (rnd() < 0.5 && at < text.length) {
      const n = 1 + int(Math.min(3, text.length - at))
      did.push(`del@${at}+${n}`)
      text = text.slice(0, at) + text.slice(at + n)
    } else {
      const w = pool.splice(0, 1 + int(3)).join('')
      did.push(`ins@${at}`)
      text = text.slice(0, at) + w + text.slice(at)
    }
  }
  return {i, text, did: did.join(',')}
}

/** Barkpark taking a span's patch: into the span's text as it is now; a span not there is left alone. */
function dmpOnto(field: ReturnType<typeof pt>, key: string, span: string, patch: ReturnType<typeof makePatches>) {
  return field.map((b) => (b._key !== key ? b : {...b, children: b.children.map((c) => (c._key !== span ? c : {...c, text: applyPatches(patch, c.text, {allowExceedingIndices: true})[0]}))}))
}

/** One pair of the span-text fuzz, drawn from `rnd`: what went wrong in it (none: right), and a line saying the case. */
function spanCase(rnd: () => number, n: number) {
  const A = typeInSpan(rnd)
  const Bv = edit(rnd, 'αβγδεζηθικλμνξοπρστυφχψω', 'b')
  const base = pt(BASE)
  const b = pt(Bv.blocks)
  const {key, span, text: from} = BASE[A.i]!
  const patch = makePatches(from, A.text)
  const spans: [string, string, string, string][] = [[`[_key=="${key}"].children[_key=="${span}"].text`, from, A.text, A.text]]
  // A's patch lands first, on the text it was typed on; B's save of the field then merges onto it.
  const afterA = dmpOnto(base, key, span, patch)
  const first = texts(freshItems(base, b, afterA))
  // B's save first; A's patch lands on B's text, and A's answer is put right through the exit.
  const saved = dmpOnto(b, key, span, patch)
  const second = texts(spanAnswer(base, spans, b, saved) ?? saved)
  const why: string[] = []
  const letters = (t: string[]) => JSON.stringify(t.map((x) => [...x].sort().join('')))
  if (letters(first) !== letters(second)) why.push('(a) orders differ')
  const all = [first.join('|'), second.join('|')]
  const added = [...new Set([...(A.text + Bv.blocks.map((x) => x.text).join('')).replace(/ /g, '')].filter((ch) => !/[a-x]/.test(ch)))]
  const baseLetters = [...BASE.map((x) => x.text).join('')]
  const kept = (ch: string) => A.text.includes(ch) || BASE[A.i]!.text.indexOf(ch) < 0
  const deleted = baseLetters.filter((ch) => !kept(ch) || !Bv.blocks.some((x) => x.text.includes(ch)))
  const lost = added.filter((ch) => all.some((t) => count(t, ch) === 0))
  const twice = [...added, ...baseLetters].filter((ch) => all.some((t) => count(t, ch) > 1))
  const back = deleted.filter((ch) => all.some((t) => count(t, ch) > 0))
  if (lost.length) why.push(`(b) lost ${lost.join('')}`)
  if (twice.length) why.push(`(c) twice ${twice.join('')}`)
  if (back.length) why.push(`deleted back ${back.join('')}`)
  return {why, line: `#${n} A ${key} ${A.did} ${JSON.stringify(A.text)} B ${Bv.did.join(',')} ${JSON.stringify(texts(b))} -> ${JSON.stringify(first)} / ${JSON.stringify(second)}: ${why.join('; ')}`}
}

test(`seeded fuzz of the span-text save (seed ${SEED}, ${CASES} pairs): typing sent as a patch while the other edits the field, either order gives each block the same letters (where in its block a patch put them is Barkpark's), every added letter once, no base letter twice, no deleted letter back`, () => {
  const rnd = prng(SEED + 1)
  const fails: string[] = []
  const tally = {a: 0, b: 0, c: 0, back: 0}
  const tag = {a: '(a)', b: '(b)', c: '(c)', back: 'deleted back'} as const
  for (let n = 0; n < CASES; n++) {
    const {why, line} = spanCase(rnd, n)
    for (const k of Object.keys(tally) as (keyof typeof tally)[]) if (why.some((w) => w.startsWith(tag[k]))) tally[k]++
    if (why.length && fails.length < 8) fails.push(line)
  }
  const report = `span save: fails ${JSON.stringify(tally)}\n${fails.join('\n')}`
  if (process.env.FUZZ_LOG) console.log(report)
  assert.deepEqual(tally, {a: 0, b: 0, c: 0, back: 0}, report)
})

// task-39ac4770a54b587a: the other deletes a block break with letters around it and pastes or
// splits there. Letters that stayed in their own base block read as the break moved, so a
// deletion of them holds. In a new block (seed 8: a paste before "h" moved it to the paste's
// last paragraph) or with their base block gone (seed 7), the same text is a letter typed again
// after a paste over it: the merge cannot tell, so the letter is kept (pt-moved-letters.test.ts).
const spanAt = (seed: number, at: number) => {
  const rnd = prng(seed + 1)
  for (let n = 0; n < at; n++) spanCase(rnd, n)
  return spanCase(rnd, at)
}
test('task-39ac4770a54b587a: span fuzz seed 3 case 113 keeps a deleted letter deleted (it stayed in its own base block)', () => {
  const {why, line} = spanAt(3, 113)
  assert.deepEqual(why, [], line)
})
test('task-39ac4770a54b587a: span fuzz seed 7 case 2631 and seed 8 case 532: where the merge cannot tell a moved letter from a new one, the letter is kept', () => {
  for (const [seed, at, ch] of [[7, 2631, 'p'], [8, 532, 'h']] as const) {
    const {why, line} = spanAt(seed, at)
    assert.deepEqual(why, [`deleted back ${ch}`], `seed ${seed}: ${line}`)
  }
})

// task-39ac4770a54b587a: this editor deletes a letter; the other deletes the block break after
// it with the next block's text, and pastes a paragraph before it. The letter stays deleted.
test('task-39ac4770a54b587a: a deleted letter stays deleted when the other deletes the break after it and pastes a paragraph before it', () => {
  const blk = (key: string, text: string) => ({_type: 'block', _key: key, style: 'normal', markDefs: [], children: [{_type: 'span', _key: `${key}s`, text, marks: []}]})
  const base = [blk('b1', 'p'), blk('b2', 'q')]
  const mine = [blk('b1', ''), blk('b2', 'q')]
  const theirs = [blk('n1', 'x'), blk('b1', 'p')]
  // p deleted, q deleted, x pasted.
  for (const out of [mergeList3(base, mine, theirs), mergeList3(base, theirs, mine), freshItems(base, theirs, mine)]) assert.deepEqual(texts(out), ['x', ''])
})
