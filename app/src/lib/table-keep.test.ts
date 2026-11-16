import {test} from 'node:test'
import assert from 'node:assert/strict'
import {rebase} from './edit-bases.ts'
import {addKept, keepOnShapeChange} from './table-keep.ts'
import {mergeCells3} from './table-merge.ts'

// A table's column changed while I typed (lib/table-keep.ts): my unsent text is kept, whole,
// not guessed into a column; theirs is the table.

const row = (k: string, cells: string[]) => ({_type: 'tableRow', _key: k, cells})
const doc = (rows: [string, string[]][], rev = 'r1') => ({_id: 'd', _rev: rev, _updatedAt: rev, t: {_type: 'table', rows: rows.map(([k, c]) => row(k, c))}})
const spots = (dirty: [string, unknown][], base: [string, unknown][]) => ({dirty: new Map(dirty), base: new Map(base), inflight: null, kept: undefined as undefined | {row: string; column: number; text: string}[]})

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
})

test('one kept entry per cell: the same text kept twice is one, a longer one grows it', () => {
  const list = [{row: 'a', column: 0, text: 'Or'}]
  addKept(list, {row: 'a', column: 0, text: 'Ord'})
  addKept(list, {row: 'a', column: 0, text: 'Or'})
  addKept(list, {row: 'a', column: 1, text: 'Ord'})
  assert.deepEqual(list.map((k) => k.text), ['Ord', 'Ord'])
})
