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

test(`seeded fuzz (seed ${SEED}, ${CASES} pairs): either save order stores the same text, every added letter once, no base letter twice`, () => {
  const rnd = prng(SEED)
  const fails: string[] = []
  const tally = {a: 0, b: 0, c: 0, kept: 0}
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
      const first = texts(merge(base, a, b)) // B saved first, A merges onto it
      const second = texts(merge(base, b, a))
      const why: string[] = []
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
  assert.deepEqual(tally, {a: 0, b: 0, c: 0, kept: 0}, report)
})
