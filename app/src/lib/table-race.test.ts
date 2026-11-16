import {test} from 'node:test'
import assert from 'node:assert/strict'
import {addColumns, moveColumn, removeColumn} from './table-input.ts'
import {columnsOf, mergeCells3, mergeRows3} from './table-merge.ts'

// Two editors in one @sanity/table, one inserting or removing a column while the other types:
// every table, cell and column of a 2 x 2 and a 2 x 3, the ambiguous ones first (all empty, all
// alike), then mixed and all different. Both merges are run: the one who changed the column
// merging onto the typed word (mergeRows3, its column known), and the one typing merging onto
// the column change (mergeCells3 for a row's cells, mergeRows3 for rows set whole).

type Op = {insert: number} | {remove: number}
const row = (k: string, cells: string[]) => ({_type: 'tableRow', _key: k, cells})
const rowsOf = (t: string[][]) => t.map((cells, i) => row(`r${i + 1}`, cells))
const grid = (rows: unknown) => (rows as {cells: string[]}[]).map((r) => r.cells)
const apply = (cells: string[], op: Op) => ('insert' in op ? [...cells.slice(0, op.insert), '', ...cells.slice(op.insert)] : cells.filter((_, i) => i !== op.remove))
/** Where the typed column goes (-1: it is the removed one). */
const goes = (c: number, op: Op) => ('insert' in op ? (op.insert <= c ? c + 1 : c) : op.remove === c ? -1 : op.remove < c ? c - 1 : c)
// mulberry32: an integer generator (a float LCG loses precision and falls into a short cycle).
let seed = 11
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
let n = 0
const key = () => `k${++n}`

function* tables(w: number): Generator<[string, string[][]]> {
  yield ['empty', [0, 1].map(() => new Array<string>(w).fill(''))]
  yield ['alike', [0, 1].map(() => new Array<string>(w).fill('x'))]
  for (let s = 0; s < 6; s++) yield ['mixed', [0, 1].map(() => Array.from({length: w}, () => ['', 'x', 'y'][Math.floor(rnd() * 3)]!))]
  yield ['distinct', [0, 1].map((r) => Array.from({length: w}, (_, c) => `c${r}${c}`))]
}

test('fuzz: a column inserted or removed while the other editor types: rows even, no word lost, doubled or split, an insert to its left never lands right of it', () => {
  let runs = 0
  for (const w of [2, 3])
    for (const [kind, t] of tables(w))
      for (let r = 0; r < 2; r++)
        for (let c = 0; c < w; c++)
          for (const op of [...Array.from({length: w + 1}, (_, p): Op => ({insert: p})), ...Array.from({length: w}, (_, p): Op => ({remove: p}))])
            for (const saved of [false, true]) {
              const was = t[r]![c]!
              const word = was ? `${was} typed` : 'word typed'
              // What both saw: the cell as it was, or with the first keys of the word saved.
              const seen = t.map((cells, i) => cells.map((v, j) => (i === r && j === c && saved ? (was ? `${was} t` : 'wo') : v)))
              const typed = t.map((cells, i) => cells.map((v, j) => (i === r && j === c ? word : v)))
              const want = typed.map((cells) => apply(cells, op))
              const marks = (v: string) => v.includes('typed') || v === 'wo' || v.endsWith(' t')
              const name = `${w} wide ${kind} ${JSON.stringify(t)}, typed in (${r}, ${c}), ${JSON.stringify(op)}${saved ? ', its first keys saved' : ''}`
              // The one who changed the column: its own write (the column it pressed), merged onto the typed word.
              const held = rowsOf(seen)
              const [[, write]] = ('insert' in op ? addColumns({rows: held}, op.insert, 1, key) : removeColumn({rows: held}, op.remove, key)) as [[string, (now: unknown) => unknown]]
              const written = write(held) as unknown[]
              const acted = mergeRows3(held, written, rowsOf(typed), [columnsOf(written)])
              assert.deepEqual(grid(acted), want, `the one who changed the column: ${name}`)
              // The one typing, onto the column change: its row's cells, and its rows set whole.
              const after = rowsOf(seen.map((cells) => apply(cells, op)))
              const cells = mergeCells3(seen[r]!, typed[r]!, apply(seen[r]!, op), rowsOf(seen), after) as string[]
              const rows = grid(mergeRows3(rowsOf(seen), rowsOf(typed), after))
              for (const [how, out, all] of [['cells', cells, [cells]], ['rows', rows[r]!, rows]] as const) {
                const label = `the one typing (${how}): ${name} gave ${JSON.stringify(all)}`
                assert.ok(all.every((cs) => cs.length === want[0]!.length), `rows even: ${label}`)
                const words = all.flatMap((cs) => cs.filter(marks))
                assert.ok(words.length <= 1 && words.every((v) => v === word), `no word doubled or split: ${label}`)
                if (goes(c, op) >= 0) assert.equal(words.length, 1, `no word lost: ${label}`)
                if ('insert' in op && op.insert <= c) assert.equal(out[c + 1], word, `an insert to its left: ${label}`)
                if (kind === 'distinct') assert.deepEqual(out, want[r], `cells all different say exactly where: ${label}`)
              }
              runs++
            }
  assert.equal(runs, 1116, "every case ran")
})

// The review of ee5540c7 (both failed there): an empty 2 x 2, A removes column 1, B types in column 2.
test('A removes column 1 of an empty table; B has typed in column 2: B\'s word stays', () => {
  const base = rowsOf([['', ''], ['', '']])
  assert.deepEqual(grid(mergeRows3(base, rowsOf([[''], ['']]), rowsOf([['', 'word'], ['', '']]))), [['word'], ['']])
  // The column A pressed is known: A's own write, merged onto B's word.
  const [[, write]] = removeColumn({rows: base}, 0, key) as [[string, (now: unknown) => unknown[]]]
  const removed = write(base)
  assert.deepEqual(grid(mergeRows3(base, removed, rowsOf([['', 'word'], ['', '']]), [columnsOf(removed)])), [['word'], ['']])
  // A pressed column 2, B's: the word goes with its column.
  const [[, own]] = removeColumn({rows: base}, 1, key) as [[string, (now: unknown) => unknown[]]]
  const gone = own(base)
  assert.deepEqual(grid(mergeRows3(base, gone, rowsOf([['', 'word'], ['', '']]), [columnsOf(gone)])), [[''], ['']])
})

test('B typing in column 2 of an empty table, A\'s removal of column 1 arrives: B\'s word stays', () => {
  assert.deepEqual(mergeCells3(['', ''], ['', 'word'], [''], rowsOf([['', ''], ['', '']]), rowsOf([[''], ['']])), ['word'])
})

test('my own column changes, several before a save and an empty table: each where I pressed it, merged onto their typing', () => {
  const base = rowsOf([['', '', ''], ['', '', '']])
  const step = (rows: unknown[], writes: unknown) => (writes as [[string, (now: unknown) => unknown[]]])[0][1](rows)
  // Remove column 1, insert left of (the new) column 2, move column 1 to the end: every step leaves an empty table.
  const m1 = step(base, removeColumn({rows: base}, 0, key))
  const m2 = step(m1, addColumns({rows: m1}, 1, 1, key))
  const m3 = step(m2, moveColumn({rows: m2}, 0, 2, key))
  // They typed in columns 2 and 3 meanwhile: B1 B2 → (remove 1) B1 B2 → (insert) B1 _ B2 → (move) _ B2 B1.
  // My notes, kept with the spot in order (lib/edit-bases.ts); a key typed meanwhile makes new lists and changes no column.
  const typedIn = m3.map((r, i) => (i === 1 ? {...(r as object), cells: ['', 'A', '']} : r))
  assert.deepEqual(grid(mergeRows3(base, typedIn, rowsOf([['', 'B1', 'B2'], ['', '', '']]), [m1, m2, m3].map(columnsOf))), [['', 'B2', 'B1'], ['', 'A', '']])
  // Rows with no notes (a reload, a copy): between equal answers their typed word is kept.
  const guessed = grid(mergeRows3(base, rowsOf([['', ''], ['', '']]), rowsOf([['', 'B1', ''], ['', '', '']])))
  assert.ok(guessed.every((cells) => cells.length === 2) && guessed.flat().filter((v) => v === 'B1').length === 1, JSON.stringify(guessed))
})

// The round-4 review (failed on c7a41471): A inserted a column left of column 1 and typed "A" in the old column, its
// write without notes (lost, as on c7a41471, to the list a key made); B typed "B" in row 2, column 1. An insert left stays left.
test('presser without notes (typed right after its insert): an insert left stays left', () => {
  assert.deepEqual(grid(mergeRows3(rowsOf([[''], ['']]), rowsOf([['', 'A'], ['', '']]), rowsOf([[''], ['B']]))), [['', 'A'], ['', 'B']])
})
