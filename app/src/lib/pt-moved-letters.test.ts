// A moved letter or a new one (task-39ac4770a54b587a). The diff reads letters taken out on one
// side of a block break and put in again on the other as the base's letters moved (farMoves),
// only when the block keys say so. Where the merge cannot tell a moved letter from a new one,
// the letter is kept. Here the letters both sides type come from the base's own few letters,
// so a typed letter can look like a base letter moved; each letter is judged by where it came
// from. node --test.
import assert from 'node:assert/strict'
import {readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {test} from 'node:test'
import {mergeList3} from './merge.ts'
import {testOnly} from './pt-merge.ts'
import {freshItems} from './pt-value.ts'

const blk = (key: string, text: string) => ({_type: 'block', _key: key, style: 'normal', markDefs: [], children: [{_type: 'span', _key: `${key}s`, text, marks: []}]})
const texts = (v: unknown) => (v as {children: {text?: string}[]}[]).map((b) => b.children.map((c) => c.text ?? '').join(''))
const merges = (base: unknown[], mine: unknown[], theirs: unknown[]) => [mergeList3(base, mine, theirs), mergeList3(base, theirs, mine), freshItems(base, theirs, mine)].map(texts)

// They paste "¶bb¶a" over "a" (b1 goes with the break) while I delete "a": their "a" is typed,
// in a new block while its base block is still there, and stays.
test('task-39ac4770a54b587a: a letter they type again in a pasted paragraph, the same as one I deleted, is kept', () => {
  const base = [blk('b0', 'a'), blk('b1', '')]
  const mine = [blk('b0', ''), blk('b1', '')]
  const theirs = [blk('b0', ''), blk('n1', 'bb'), blk('n2', 'a')]
  for (const out of merges(base, mine, theirs)) assert.deepEqual(out, ['', 'bb', 'a'])
})

function prng(s: number) {
  return () => ((s = (s * 1103515245 + 12345) >>> 0), s / 2 ** 32)
}
const bag = (s: string) => [...s].sort().join('')

/** One pair: they select and paste (paragraphs too) over a base of "abc" letters; I type capitals and delete. Whether the merge has the right letters. */
function letterCase(rnd: () => number): {right: boolean; line: string} {
  const pick = (n: number) => Math.floor(rnd() * n)
  const word = (n: number, al = 'abc') => Array.from({length: n}, () => al[pick(al.length)]).join('')
  const nb = 2 + pick(2)
  const base = Array.from({length: nb}, (_, i) => ({k: `b${i}`, t: word(pick(5))}))
  const joined = base.map((b) => b.t).join('\n')
  const s = pick(joined.length + 1)
  const e = s + pick(joined.length - s + 1)
  const ins = Array.from({length: 1 + pick(3)}, () => word(pick(4))).join('\n')
  const parts = (joined.slice(0, s) + ins + joined.slice(e)).split('\n')
  const blockAt = (pos: number) => joined.slice(0, pos).split('\n').length - 1
  const [sb, eb] = [blockAt(s), blockAt(e)]
  const keys = base.slice(0, sb).map((b) => b.k)
  const mid = parts.length - (nb - 1 - eb) - sb
  for (let i = 0; i < mid; i++) keys.push(i === 0 ? base[sb]!.k : i === mid - 1 && rnd() < 0.5 && eb !== sb ? base[eb]!.k : `n${i}`)
  keys.push(...base.slice(eb + 1).map((b) => b.k))
  const theirs = parts.map((t, i) => blk(keys[i]!, t))
  const gone = base.map(() => new Set<number>())
  const mine = base.map((b, bi) => {
    let r = ''
    for (let j = 0; j <= b.t.length; j++) {
      if (rnd() < 0.15) r += word(1 + pick(2), 'XYZ')
      if (j < b.t.length) rnd() < 0.25 ? gone[bi]!.add(j) : (r += b.t[j])
    }
    return blk(b.k, r)
  })
  // Right: the base letters neither took out, their paste, my capitals.
  let kept = ''
  let pos = 0
  base.forEach((b, bi) => {
    for (let j = 0; j < b.t.length; j++, pos++) if (!(pos >= s && pos < e) && !gone[bi]!.has(j)) kept += b.t[j]
    pos++
  })
  const capitals = texts(mine).join('').replace(/[abc]/g, '')
  const want = bag(kept + ins.replace(/\n/g, '') + capitals)
  const B = base.map((b) => blk(b.k, b.t))
  const got = merges(B, mine, theirs)
  return {right: got.every((g) => bag(g.join('')) === want), line: `base ${JSON.stringify(base.map((b) => b.t))} mine ${JSON.stringify(texts(mine))} theirs ${JSON.stringify(parts)} keys ${keys} -> ${JSON.stringify(got[0])}, want letters ${want}`}
}

const LETTER_SEED = 1
const LETTER_CASES = 4000
// Wrong with farMoves and without it, as before task-39ac (task-8ed857cec55bb8c5: pasting
// "¶Hi¶Tom." over "Tom." while I delete "Tom." loses their "Tom."). It may only go down.
const WRONG_BOTH = 327

test(`task-39ac4770a54b587a: seeded fuzz (seed ${LETTER_SEED}, ${LETTER_CASES} pairs), typed letters the same as base letters: no case reading letters as moved gets wrong that the plain diff gets right; at most ${WRONG_BOTH} wrong either way (task-8ed857cec55bb8c5)`, () => {
  const run = (far: boolean) => {
    testOnly.farMoves = far
    const rnd = prng(LETTER_SEED)
    try {
      return Array.from({length: LETTER_CASES}, () => letterCase(rnd))
    } finally {
      testOnly.farMoves = true
    }
  }
  const [on, off] = [run(true), run(false)]
  const worse = on.flatMap((c, n) => (!c.right && off[n]!.right ? [`#${n} ${c.line}`] : []))
  assert.deepEqual(worse, [])
  assert.ok(on.filter((c) => !c.right).length <= WRONG_BOTH, `${on.filter((c) => !c.right).length} wrong`)
})

// The switch is for these tests: no product file names it.
test('testOnly in lib/pt-merge.ts is used by tests alone', () => {
  const src = join(import.meta.dirname, '..')
  const files = (readdirSync(src, {recursive: true}) as string[]).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith('pt-merge.ts'))
  const users = files.filter((f) => /\btestOnly\b/.test(readFileSync(join(src, f), 'utf8')))
  assert.deepEqual(users, [])
  assert.doesNotMatch(readFileSync(join(src, 'lib/pt-merge.ts'), 'utf8'), /testOnly\.farMoves\s*=[^=]/)
})
