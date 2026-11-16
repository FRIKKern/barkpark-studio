import {test} from 'node:test'
import assert from 'node:assert/strict'
import {rebase} from './edit-bases.ts'
import {addKept, keepOnShapeChange, typedSince, type TableKept} from './table-keep.ts'
import {mergeCells3, mergeRows3} from './table-merge.ts'

// A table's column changed while I typed (lib/table-keep.ts): my unsent text is kept, whole,
// not guessed into a column; theirs is the table.

const row = (k: string, cells: string[]) => ({_type: 'tableRow', _key: k, cells})
const doc = (rows: [string, string[]][], rev = 'r1') => ({_id: 'd', _rev: rev, _updatedAt: rev, t: {_type: 'table', rows: rows.map(([k, c]) => row(k, c))}})
const spots = (dirty: [string, unknown][], base: [string, unknown][]) => ({dirty: new Map(dirty), base: new Map(base), inflight: null, kept: undefined as undefined | TableKept[]})

test('insright: an empty table, my word in row 2 column 1 unsent, theirs added a column: my word is kept, theirs is the table', () => {
  const before = doc([['a', ['', '', '']], ['b', ['', '', '']]])
  const theirs = doc([['a', ['', '', '', '']], ['b', ['', '', '', '']]], 'r2')
  const e = spots([['t.rows[_key=="b"].cells', ['Ord', '', '']]], [['t.rows[_key=="b"].cells', ['', '', '']]])
  keepOnShapeChange(e, theirs, before)
  assert.deepEqual(e.kept?.map(({row, column, text}) => ({row, column, text})), [{row: 'b', column: 0, text: 'Ord'}])
  assert.equal(e.dirty.size, 0)
})

test('a word typed on after text saved once in its row goes back where that text is now; a fragment two cells could hold is kept', () => {
  const before = doc([['a', ['ae', 'af']]])
  const theirs = doc([['a', ['', 'ae', 'af']]], 'r2')
  const e = spots([['t.rows[_key=="a"].cells', ['ae', 'af<T>']]], [['t.rows[_key=="a"].cells', ['ae', 'af']]])
  keepOnShapeChange(e, theirs, before)
  assert.equal(e.kept, undefined)
  assert.deepEqual(e.dirty.get('t.rows[_key=="a"].cells'), ['', 'ae', 'af<T>'])
  const tie = doc([['a', ['<', '<', 'x']]], 'r2')
  const f = spots([['t.rows[_key=="a"].cells', ['', '<T1>', '', 'x']]], [['t.rows[_key=="a"].cells', ['', '<', '', 'x']]])
  keepOnShapeChange(f, tie, doc([['a', ['', '<', '', 'x']]]))
  assert.deepEqual(f.kept?.map((k) => k.text), ['<T1>'])
})

test('same width: rows merge as before; both changed one cell: theirs stays, mine is kept (never cut)', () => {
  const was = doc([['a', ['x', 'y']]])
  const e = {...spots([['t.rows[_key=="a"].cells', ['x mine', 'y']]], [['t.rows[_key=="a"].cells', ['x', 'y']]]), rev: 'r1'}
  rebase(e as never, doc([['a', ['x theirs', 'y']]], 'r2') as never, was as never)
  assert.deepEqual(e.kept?.map(({row, column, text}) => ({row, column, text})), [{row: 'a', column: 0, text: 'x mine'}])
  const kept: [number, unknown][] = []
  assert.deepEqual(mergeCells3(['', ''], ['a', 'b'], ['', 'c'], undefined, undefined, (c, t) => kept.push([c, t])), ['a', 'c'])
  assert.deepEqual(kept, [[1, 'b']])
  // Both wrote the same: it stands once, nothing kept.
  assert.deepEqual(mergeCells3([''], ['same'], ['same'], undefined, undefined, (c, t) => kept.push([c, t])), ['same'])
  assert.equal(kept.length, 1)
})

test('one kept entry per cell: the same text kept twice is one, a longer one grows it', () => {
  const list = [{row: 'a', column: 0, text: 'Or'}]
  addKept(list, {row: 'a', column: 0, text: 'Ord'})
  addKept(list, {row: 'a', column: 0, text: 'Or'})
  addKept(list, {row: 'a', column: 1, text: 'Ord'})
  assert.deepEqual(list.map((k) => k.text), ['Ord', 'Ord'])
})

test('rows set whole (my row or column change) and theirs changed a cell I changed too: theirs stays, mine is kept, never joined', () => {
  const was = doc([['a', ['x', 'y']]])
  // My rows write: a row added and cell a/0 typed in; theirs typed in a/0 too.
  const mine = [row('a', ['x mine', 'y']), row('n', ['', ''])]
  const e = {...spots([['t.rows', mine]], [['t.rows', was.t.rows]]), rev: 'r1'}
  rebase(e as never, doc([['a', ['x theirs', 'y']]], 'r2') as never, was as never)
  assert.deepEqual(e.kept?.map(({row, column, text}) => ({row, column, text})), [{row: 'a', column: 0, text: 'x mine'}])
  assert.deepEqual((e.dirty.get('t.rows') as {cells: string[]}[]).map((r) => r.cells), [['x theirs', 'y'], ['', '']])
  // Without a keep (a merge that is not a rebase): the two are joined as before.
  const kept: unknown[] = []
  assert.deepEqual((mergeRows3([row('a', ['x'])], [row('a', ['x 1'])], [row('a', ['x 2'])], undefined, (...k) => kept.push(k)) as {cells: string[]}[])[0]!.cells, ['x 2'])
  assert.deepEqual(kept, [['a', 0, 'x 1']])
})

test('a saved text the table says went with its column is not followed into the cell theirs typed on to read the same: kept', () => {
  // Mine: 'x<' saved in row c column 1, typing on. Theirs removed column 1 (the other rows say so)
  // and typed '<' after column 0's 'x'.
  const before = doc([['a', ['y', 'x']], ['b', ['x', '']], ['c', ['x', 'x<']]])
  const e = spots([['t.rows[_key=="c"].cells', ['x', 'x<T3']]], [['t.rows[_key=="c"].cells', ['x', 'x<']]])
  keepOnShapeChange(e, doc([['a', ['y']], ['b', ['x']], ['c', ['x<']]], 'r2'), before)
  assert.deepEqual(e.kept?.map((k) => k.text), ['x<T3'])
  assert.equal(e.dirty.size, 0)
})

test('the card takes only what I typed since I went into the cell, when what the cell held then stands in the row', () => {
  // I clicked a cell holding the other's first keys ('x<Q') and typed '<U8>'; they typed on to 'x<Q8>'.
  assert.equal(typedSince('x<Q<U8>', 'x<Q', ['x<Q8>', '']), '<U8>')
  // What it held is gone from the row (their column change took it): kept whole, for its context.
  assert.equal(typedSince('Total 2024', 'Total', ['Sum', '']), 'Total 2024')
  // An empty cell, or nothing typed since: as it is.
  assert.equal(typedSince('<T1>', '', ['<', 'x']), '<T1>')
  assert.equal(typedSince('x', 'x', ['x']), 'x')
  // My own first keys saved on from it ('x<'): they are mine, the card holds all of it.
  assert.equal(typedSince('x<T4>', 'x', ['x<', 'x']), 'x<T4>')
})

test('price: a filled table, my word in an empty cell unsent, theirs added a column after mine: my word stays in its cell', () => {
  const filled: [string, string[]][] = [['a', ['ae', 'af', 'ag']], ['b', ['be', 'bf', 'bg']], ['c', ['', '', '']]]
  const at = (rows: [string, string[]][], f: (c: string[]) => string[]) => doc(rows.map(([k, c]) => [k, f(c)]), 'r2')
  const mine = () => spots([['t.rows[_key=="c"].cells', ['', 'Ord', '']]], [['t.rows[_key=="c"].cells', ['', '', '']]])
  // Add column (at the end), and Insert right of my column: my cell did not move.
  for (const f of [(c: string[]) => [...c, ''], (c: string[]) => [c[0]!, c[1]!, '', c[2]!]]) {
    const e = mine()
    keepOnShapeChange(e, at(filled, f), doc(filled))
    assert.equal(e.kept, undefined)
    assert.deepEqual(e.dirty.get('t.rows[_key=="c"].cells'), f(['', 'Ord', '']))
  }
  // Inserted left of it (it moved), or an empty table (which column is new, nothing says): kept.
  const left = mine()
  keepOnShapeChange(left, at(filled, (c) => ['', ...c]), doc(filled))
  assert.deepEqual(left.kept?.map((k) => k.text), ['Ord'])
  const empty: [string, string[]][] = filled.map(([k]) => [k, ['', '', '']])
  const none = mine()
  keepOnShapeChange(none, at(empty, (c) => [...c, '']), doc(empty))
  assert.deepEqual(none.kept?.map((k) => k.text), ['Ord'])
})

test('an empty cell of mine stays only where cells say so even if theirs typed in an empty one since', () => {
  // ['', ''] → theirs typed '<P1>' in column 1 and inserted a column at 0: '' and '' read alike, so mine is kept.
  const e = spots([['t.rows[_key=="a"].cells', ['<T1>', '']]], [['t.rows[_key=="a"].cells', ['', '']]])
  keepOnShapeChange(e, doc([['a', ['', '', '<P1>']]], 'r2'), doc([['a', ['', '']]]))
  assert.deepEqual(e.kept?.map((k) => k.text), ['<T1>'])
})
