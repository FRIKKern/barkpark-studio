import {test} from 'node:test'
import assert from 'node:assert/strict'
import {caretColumn, setCell, withWrites} from './table-input.ts'
import {keepOnShapeChange, type TableKept} from './table-keep.ts'
import {sureColumn} from './table-merge.ts'
import {Client, Server} from './table-sim.ts'

// One alignment for the whole table (lib/table-merge.ts sureColumn): a column's place is read
// from every row at once, and taken only when every best reading agrees. Played by hand with the
// sim's two editors (lib/table-sim.ts) for the scenes the reviews of #1260 found.

const row = (k: string, cells: string[]) => ({_type: 'tableRow', _key: k, cells})
const doc = (rows: string[][]) => ({_type: 'table', rows: rows.map((cs, i) => row(`r${i}`, [...cs]))})
const stored = (s: Server) => s.doc.t.rows.map((r: {cells: string[]}) => r.cells)
const save = (c: Client, server: Server) => {
  c.send()
  const r = c.request!
  c.request = null
  c.answer = server.mutate(r.rev, r.set, r.unset)
  c.onAnswer(server)
}
const frame = (c: Client, server: Server) => c.applyServer(JSON.parse(JSON.stringify(server.doc)))
const type = (c: Client, server: Server, word: string) => {
  for (const ch of word) c.key(ch)
  if (c.e.dirty.size) save(c, server)
}

test('a column\'s place is sure only when every best reading of the rows agrees', () => {
  const sure = (rows: [string[], string[]][], i: number) => sureColumn(rows, rows[0]![0].length, rows[0]![1].length, i, true)
  // An empty table with a column added at its end, or a row of one text with one removed: nothing says which.
  assert.equal(sure([[['', ''], ['', '', '']]], 0), undefined)
  assert.deepEqual([0, 1, 2].map((i) => sure([[['x', 'x', 'x'], ['x', 'x']]], i)), [undefined, undefined, undefined])
  // The new empty column stands among cells that all hold text: every column is known.
  assert.deepEqual([0, 1, 2].map((i) => sure([[['x', 'x', 'x'], ['x', '', 'x', 'x']]], i)), [0, 2, 3])
  // One row that says it, read with an empty one: the table says it.
  assert.deepEqual([0, 1].map((i) => sure([[['', ''], ['', '', '']], [['a', 'b'], ['a', '', 'b']]], i)), [0, 2])
  // A column removed in distinct text: the removed one is -1.
  assert.deepEqual([0, 1, 2].map((i) => sure([[['a', 'b', 'c'], ['a', 'c']]], i)), [0, -1, 1])
})

test('the caret in an empty cell, the other editor appends a column: the caret does not move one cell right', () => {
  // Review 1260i nice-to-have 1 (task-2e20fcf089c3a4db): on 6ff093de the caret went from column 0 to 1.
  assert.notEqual(caretColumn([[['', ''], ['', '', '']]], 2, 3, 0, 0), 1)
  // Two editors: T clicks R2C2 of an empty 2 x 3, P inserts a column right of column 3, then T types.
  const server = new Server(doc([['', '', ''], ['', '', '']]))
  const t = new Client('T', server.doc, [], (w) => (w === 3 ? [0, 1, 2] : [0, 1, 2, 100]))
  const p = new Client('P', server.doc, [], () => [0, 1, 2, 100])
  assert.ok(t.click('r1', 1))
  p.press({kind: 'inscol', at: 3})
  save(p, server)
  frame(t, server)
  t.render()
  // The caret could not tell its column: it left the cell (TableInput rests it on the grid), and T clicks again.
  if (!t.caret && !t.card) assert.ok(t.click('r1', 1))
  type(t, server, '<T>')
  t.render()
  const cells = stored(server).flat()
  assert.deepEqual(stored(server)[1], ['', '<T>', '', ''], `stored ${JSON.stringify(stored(server))}, card ${JSON.stringify(t.kept)}`)
  assert.equal(cells.filter((c: string) => c.includes('<T>')).length, 1)
})

test('Insert column left in an empty table while the other editor types: the new column stays on the left', () => {
  // task-42372682c2c61a16 (sim seed 8801 #53, INSERT-LEFT-WRONG-SIDE): P's word typed in the old column
  // after the insert read, cell by cell, as if the new column were the right one, and T's caret stayed.
  const server = new Server(doc([['', ''], ['', '']]))
  const t = new Client('T', server.doc, [], (w) => (w === 2 ? [0, 1] : [100, 0, 1]))
  const p = new Client('P', server.doc, [], () => [100, 0, 1])
  assert.ok(t.click('r1', 0))
  p.press({kind: 'inscol', at: 0})
  save(p, server)
  p.render()
  assert.ok(p.click('r0', 0))
  type(p, server, '<P>')
  frame(t, server)
  t.render()
  if (!t.caret && !t.card) assert.ok(t.click('r1', 0))
  type(t, server, '<T>')
  t.render()
  assert.deepEqual(stored(server), [['', '<P>', ''], ['', '<T>', '']], `card ${JSON.stringify(t.kept)}`)
})

test('my text typed in a table of one text, the other editor adds a column: the table says where, my text stays in its cell', () => {
  // task-23ebf76a39803402: on 6ff093de the row alone read [x, x, x] -> [x, '', x, x] as unsure, and the text went to the card.
  const server = new Server(doc([['x', 'x', 'x'], ['x', 'x', 'x']]))
  const t = new Client('T', server.doc, [], (w) => (w === 3 ? [0, 1, 2] : [0, 100, 1, 2]))
  const p = new Client('P', server.doc, [], () => [0, 100, 1, 2])
  assert.ok(t.click('r0', 1))
  for (const ch of '<T>') t.key(ch) // not sent yet
  p.press({kind: 'inscol', at: 1})
  save(p, server)
  frame(t, server)
  t.render()
  if (t.e.dirty.size) save(t, server)
  assert.deepEqual(t.kept, [])
  assert.deepEqual(stored(server), [['x', '', 'x<T>', 'x'], ['x', '', 'x', 'x']])
})

test('a key in a padded cell (a short row drawn to the table\'s width) stores rows of equal length', () => {
  // task-c5f8a76041ea18ec: on 6ff093de the short row grew only to the cell typed in.
  const t0 = {_type: 'table', rows: [row('a', ['A1', 'A2', 'A3']), row('b', ['B1'])]}
  const after = withWrites(t0, setCell(t0, 1, 1, 'B2', () => 'k', '')) as {rows: {cells: string[]}[]}
  assert.deepEqual(after.rows.map((r) => r.cells), [['A1', 'A2', 'A3'], ['B1', 'B2', '']])
  // Rows without keys (written whole) too.
  const bare = {_type: 'table', rows: [{cells: ['A1', 'A2', 'A3']}, {cells: ['B1']}]}
  const whole = withWrites(bare, setCell(bare, 1, 1, 'B2', () => 'k', '')) as {rows: {cells: string[]}[]}
  assert.deepEqual(whole.rows.map((r) => r.cells), [['A1', 'A2', 'A3'], ['B1', 'B2', '']])
})

// Review of #1280: theirs was drawn with a first key ('S'), typed on to 'Size', added a column at
// the end and began a new word with the same key in the next column. That row reads as a column
// put in left of mine; it is not, and my unsent word stays in its column or goes to the card.
for (const [name, drawnA, nowA] of [
  ['a first key', ['S', '', '', ''], ['Size', 'S', '', '', '']],
  ['two keys', ['Si', '', '', ''], ['Size', 'Si', '', '', '']],
] as const)
  test(`a lookalike in the next column (${name}) never puts my word one cell right`, () => {
    const table = (a: readonly string[], b: string[], rev: string) => ({_id: 'd', _rev: rev, _updatedAt: rev, t: {_type: 'table', rows: [row('a', [...a]), row('b', b)]}})
    const path = 't.rows[_key=="b"].cells'
    const e = {dirty: new Map<string, unknown>([[path, ['', 'Mine', '', '']]]), base: new Map<string, unknown>([[path, ['', '', '', '']]]), inflight: null, kept: undefined as TableKept[] | undefined}
    keepOnShapeChange(e, table(nowA, ['', '', '', '', ''], 'r2'), table(drawnA, ['', '', '', ''], 'r1'))
    const placed = e.dirty.get(path) as string[] | undefined
    if (placed) assert.equal(placed.indexOf('Mine'), 1, `placed ${JSON.stringify(placed)}`)
    else assert.deepEqual(e.kept?.map((k) => k.text), ['Mine'])
  })

// Review of #1280, the typing path: a key from the old grid after the other editor added a column,
// in a table where a drawn word grew and a new one began beside it with the same keys. That row
// says nothing of where the column went; my key lands in its own column or goes to the card.
for (const [name, drawn, now, r, c, meant] of [
  ['S grew to Size, a new S beside it', [['S', '', '', ''], ['', '', '', '']], [['Size', 'S', '', '', ''], ['', '', '', '', '']], 1, 1, 1],
  ['Si grew to Size, a new Si beside it', [['Si', '', '', ''], ['', '', '', '']], [['Size', 'Si', '', '', ''], ['', '', '', '', '']], 1, 1, 1],
  ['two rows grew', [['S', '', '', ''], ['M', '', '', ''], ['', '', '', '']], [['Size', 'S', '', '', ''], ['Med', 'M', '', '', ''], ['', '', '', '', '']], 2, 1, 1],
  ['a key in column 3, the column added after it', [['S', '', '', ''], ['', '', '', '']], [['Size', 'S', '', '', ''], ['', '', '', '', '']], 1, 2, 2],
  ['the drawn S in column 2 grew', [['', 'S', '', ''], ['', '', '', '']], [['', 'Size', 'S', '', ''], ['', '', '', '', '']], 1, 2, 2],
] as const)
  test(`a grown word beside a lookalike (${name}): my key never lands one cell right`, () => {
    let card = ''
    const [[, write]] = setCell(doc(drawn as unknown as string[][]), r, c, 'M', () => 'k', '', (t) => void (card = t)) as [string, (now: unknown, table?: unknown) => unknown][]
    const out = write(now[r], doc(now as unknown as string[][])) as string[]
    if (card) assert.equal(card, 'M')
    else assert.equal(out.indexOf('M'), meant, JSON.stringify(out))
  })
