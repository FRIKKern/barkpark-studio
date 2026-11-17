import {test} from 'node:test'
import assert from 'node:assert/strict'
import {addColumns, addRows, caretColumn, columnNow, createTable, isTableField, isTableValue, moveColumn, moveRow, parseCells, pasteCells, removeColumn, removeRow, setCell, tableBlank, tableGrid, tableOptions, tablePreview, withWrites} from './table-input.ts'
import {alignColumns, mergeCells3, mergeRows3, mergeTablePart} from './table-merge.ts'
import {tableDiff} from './table-diff.ts'

// The table field (Sanity's @sanity/table): its stored shape, what each edit writes, a pasted
// block, the grid, the preview, Review changes' grid, and two editors' edits to one table.

const row = (key: string, ...cells: string[]) => ({_type: 'tableRow', _key: key, cells})
const table = (...rows: unknown[]) => ({_type: 'table', rows})
let n = 0
const key = () => `k${++n}`
const T = table(row('a', 'A1', 'A2', 'A3'), row('b', 'B1', 'B2', 'B3'))

test('a table field is a composite named table; a new table is the plugin\'s two by two, in its stored shape', () => {
  assert.equal(isTableField({type: 'composite', namedType: 'table'}), true)
  assert.equal(isTableField({type: 'composite', namedType: 'code'}), false)
  assert.equal(isTableValue(T), true)
  assert.equal(isTableValue({_type: 'table'}), false)
  assert.equal(tableOptions({options: {rowType: 'my-row'}}).rowType, 'my-row')
  n = 0
  assert.deepEqual(createTable({theme: 'x'}, tableOptions(undefined).rowType, key), [['', {theme: 'x', _type: 'table', rows: [{_type: 'tableRow', _key: 'k1', cells: ['', '']}, {_type: 'tableRow', _key: 'k2', cells: ['', '']}]}]])
})

test('typing writes its own row\'s cells, made onto the row as it is now; rows and columns write the smallest spot', () => {
  const [[path, make]] = setCell(T, 1, 2, 'new', key) as [[string, (now: unknown) => unknown]]
  assert.equal(path, 'rows[_key=="b"].cells')
  // Another editor's word in the next cell, not drawn here yet, stays.
  assert.deepEqual(make(['B1', 'theirs', 'B3']), ['B1', 'theirs', 'new'])
  assert.deepEqual(withWrites(T, setCell(T, 0, 0, 'x', key)), table(row('a', 'x', 'A2', 'A3'), row('b', 'B1', 'B2', 'B3')))
  assert.deepEqual(removeRow(T, 0, key), [['rows[_key=="a"]', undefined]])
  // The last row or column takes the table with it.
  assert.deepEqual(removeRow(table(row('a', 'x')), 0, key), [['', undefined]])
  assert.deepEqual(removeColumn(table(row('a', 'x'), row('b', 'y')), 0, key), [['', undefined]])
  // What changes the rows together sets `rows`, made onto the rows as they are when queued.
  const rows = (writes: unknown[][], now: unknown = T.rows) => (assert.equal(writes.length, 1), assert.equal(writes[0]![0], 'rows'), (writes[0]![1] as (now: unknown) => unknown)(now))
  n = 0
  assert.deepEqual(rows(addRows(T, 1, 1, 'tableRow', key)), [T.rows[0], row('k1', '', '', ''), T.rows[1]])
  // A row another editor added on top, not drawn here yet: mine still goes before the row it was put before.
  assert.deepEqual(rows(addRows(T, 1, 1, 'tableRow', key), [row('z', '', '', ''), ...T.rows]), [row('z', '', '', ''), T.rows[0], row('k2', '', '', ''), T.rows[1]])
  assert.deepEqual(rows(addRows(T, 2, 2, 'tableRow', key)), [...T.rows, row('k3', '', '', ''), row('k4', '', '', '')])
  assert.deepEqual(rows(moveRow(T, 1, 0, key)), [T.rows[1], T.rows[0]])
  assert.deepEqual(rows(addColumns(T, 1, 1, key)), [row('a', 'A1', '', 'A2', 'A3'), row('b', 'B1', '', 'B2', 'B3')])
  assert.deepEqual(rows(removeColumn(T, 0, key)), [row('a', 'A2', 'A3'), row('b', 'B2', 'B3')])
  assert.deepEqual(rows(moveColumn(T, 0, 2, key)), [row('a', 'A2', 'A3', 'A1'), row('b', 'B2', 'B3', 'B1')])
  // A column change leaves every row the same length, a short row of an import included.
  const ragged = [row('a', '1', '2'), row('b', '3')]
  assert.deepEqual(rows(addColumns(table(...ragged), 2, 1, key), ragged), [row('a', '1', '2', ''), row('b', '3', '', '')])
  // Rows without keys (a hand-made import) get them with the first edit, written whole.
  n = 0
  const bare = [{cells: ['a']}, {cells: ['b']}]
  assert.deepEqual(rows(setCell(table(...bare), 1, 0, 'c', key), bare), [{cells: ['a'], _key: 'k1'}, {cells: ['c'], _key: 'k2'}])
})

test('a key from the old grid\'s input, after another editor\'s column came in: it lands in its own column, and no row grows', () => {
  // React has not drawn the new grid yet, so the key comes from the input of the column as it was drawn.
  const typed = (drawn: unknown, column: number, text: string, now: unknown[]) => (setCell(drawn, 0, column, text, key)[0]![1] as (now: unknown) => unknown)(now)
  // 2 x 2, I type in column 2, they remove column 1: my row is one cell, my word in it, once.
  assert.deepEqual(typed(table(row('a', '', 'word typed'), row('b', '', '')), 1, 'word typed ', ['word typed']), ['word typed '])
  // 2 x 3, they remove column 1: column 2 is now column 1, and column 3 (now 2) is not touched.
  assert.deepEqual(typed(table(row('a', '', 'word', 'x'), row('b', '', '', '')), 1, 'words', ['word', 'x']), ['words', 'x'])
  // They insert a column left of mine: my key goes one column right, not into the new cell.
  assert.deepEqual(typed(table(row('a', '', 'word'), row('b', '', '')), 1, 'words', ['', '', 'word']), ['', '', 'words'])
  // They remove my own column: the key goes with it, into no neighbour.
  assert.deepEqual(typed(table(row('a', 'x', 'word'), row('b', '', '')), 1, 'words', ['x']), ['x'])
  // The table as drawn is one column already, the input still the second's: the cell typed on from, or nothing.
  assert.deepEqual(typed(table(row('a', 'word typed'), row('b', '')), 1, 'word typed ', ['word typed']), ['word typed '])
  assert.deepEqual(typed(table(row('a', ''), row('b', '')), 1, 'w', ['']), [''])
  // Drawn while my row was still the old width and the other row the new one: my row's own width counts.
  assert.deepEqual(typed(table(row('a', '', 'word typed '), row('b', '', '', '')), 1, 'word typed b', ['', '', 'word typed']), ['', '', 'word typed b'])
  // A short row of an import still grows to the grid's width when typed in, and no further.
  assert.deepEqual(typed(table(row('a', 'x'), row('b', '', '')), 1, 'y', ['x']), ['x', 'y'])
  // One row's paste the same way.
  const [[, paste]] = pasteCells(table(row('a', '', 'w', ''), row('b', '', '', '')), 0, 1, [['p', 'q']], 'tableRow', key) as [[string, (now: unknown) => unknown]]
  assert.deepEqual(paste(['w', '']), ['p', 'q'])
})

test('the table as read before my last save came back (all empty then): my row\'s own base still says where my word\'s column went', () => {
  // My "word " saved, theirs (a column inserted left) holds it; the rows read then are older than that save.
  const [before, after] = [[row('a', '', ''), row('b', '', '')], [row('a', '', '', 'word '), row('b', '', '', '')]]
  assert.deepEqual(mergeCells3(['', 'word '], ['', 'word t'], ['', '', 'word '], before, after), ['', '', 'word t'])
})

test('a pasted block: tab-separated (a spreadsheet\'s), CSV with quotes, lines; one cell\'s worth is left to the input', () => {
  assert.equal(parseCells('just words, with a comma'), null)
  assert.deepEqual(parseCells('a\tb\r\nc\td\r\n'), [['a', 'b'], ['c', 'd']])
  // Excel and Sheets quote a cell that holds a line break, a tab or a quote.
  assert.deepEqual(parseCells('a\t"two\nlines"\t"say ""hi"""\nb\t\tc'), [['a', 'two\nlines', 'say "hi"'], ['b', '', 'c']])
  assert.deepEqual(parseCells('name,price\n"Kari, Ola",12\nPer,"1,5"'), [['name', 'price'], ['Kari, Ola', '12'], ['Per', '1,5']])
  // Lines that are no CSV: one cell each, down the column.
  assert.deepEqual(parseCells('first, with a comma\nsecond'), [['first, with a comma'], ['second']])
})

test('a paste fills from the focused cell and grows the table; inside one row it writes that row only', () => {
  const [[path, make]] = pasteCells(T, 0, 1, [['x', 'y']], 'tableRow', key) as [[string, (now: unknown) => unknown]]
  assert.equal(path, 'rows[_key=="a"].cells')
  assert.deepEqual(make(undefined), ['A1', 'x', 'y'])
  n = 0
  assert.deepEqual(withWrites(T, pasteCells(T, 1, 2, [['p', 'q'], ['r', 's']], 'tableRow', key)), table(row('a', 'A1', 'A2', 'A3', ''), row('b', 'B1', 'B2', 'p', 'q'), row('k1', '', '', 'r', 's')))
})

test('the grid pads short rows for the drawing only; required asks for text in a cell; the preview is the size and the first cells', () => {
  const ragged = table(row('a', 'x'), {_type: 'tableRow', _key: 'b', cells: ['y', 2, null]}, 'junk')
  assert.deepEqual(tableGrid(ragged), {rows: [{key: 'a', cells: ['x', '', '']}, {key: 'b', cells: ['y', '2', '']}], columns: 3})
  assert.deepEqual(tableGrid(undefined), {rows: [], columns: 0})
  assert.equal(tableBlank(table(row('a', '', ' '))), true)
  assert.equal(tableBlank(undefined), true)
  assert.equal(tableBlank(T), false)
  assert.deepEqual(tablePreview(T), {rows: 2, columns: 3, text: 'A1 · A2 · A3 · B1'})
})

test('Review changes: changed cells, added and removed rows and columns, each where it was', () => {
  const after = table(row('a', 'A1!', 'new', 'A2', 'A3'), row('c', 'C1', '', 'C2', 'C3'))
  const d = tableDiff(T, after)
  assert.deepEqual(d.columns.map((c) => c.change), ['same', 'added', 'same', 'same'])
  assert.deepEqual(d.rows.map((r) => [r.key, r.change]), [['a', 'changed'], ['b', 'removed'], ['c', 'added']])
  assert.deepEqual(d.rows[0]!.cells.map((c) => c.change), ['changed', 'added', 'same', 'same'])
  assert.deepEqual(d.rows[0]!.cells[0], {change: 'changed', before: 'A1', after: 'A1!'})
  assert.deepEqual(d.rows[1]!.cells.map((c) => c.change), ['removed', 'removed', 'removed', 'removed'])
  assert.equal(tableDiff(T, T).same, true)
  assert.equal(tableDiff(undefined, T).rows.every((r) => r.change === 'added'), true)
  const gone = tableDiff(T, table(row('a', 'A1', 'A3'), row('b', 'B1', 'B3')))
  assert.deepEqual(gone.columns, [{change: 'same', before: 1, after: 1}, {change: 'removed', before: 2, after: 0}, {change: 'same', before: 3, after: 2}])
})

test('which column became which is read from all the rows; beside an equal column the new one is the later', () => {
  assert.deepEqual(alignColumns([[['a', '', 'c'], ['a', '', '', 'c']], [['d', 'e', 'f'], ['d', 'new', 'e', 'f']]], 3, 4), [0, 2, 3])
  assert.deepEqual(alignColumns([[['a', '', 'c'], ['a', '', '', 'c']]], 3, 4), [0, 1, 3])
  assert.deepEqual(alignColumns([[['a', 'b', 'c'], ['a', 'c']]], 3, 2), [0, -1, 1])
})

test('a mostly empty table: the word being typed says where its column went, not the empty cells around it', () => {
  // B types in row 1, column 2 of a fresh 2 x 3 table; A puts a column left of it. B's grid a
  // moment apart: B's own text has run on since, every other cell is empty. The caret (and
  // the rest of the word) goes with the word, not into A's new column.
  assert.deepEqual(alignColumns([[['', 'word typ', ''], ['', '', 'word typed by', '']], [['', '', ''], ['', '', '', '']]], 3, 4), [0, 2, 3])
  // And the other way round: a column left of it removed.
  assert.deepEqual(alignColumns([[['', '', 'word typ'], ['', 'word typed by']], [['', '', ''], ['', '']]], 3, 2), [0, -1, 1])
  // B's unsaved run of the word, onto A's column, read from the rows as the server had them and has them now.
  const before = [row('a', '', 'word typ', ''), row('b', '', '', '')]
  const after = [row('a', '', '', 'word typ', ''), row('b', '', '', '', '')]
  assert.deepEqual(mergeCells3(['', 'word typ', ''], ['', 'word typed by B', ''], ['', '', 'word typ', ''], before, after), ['', '', 'word typed by B', ''])
})

test('two editors in one row: each cell stays in its own column, empty neighbours or not', () => {
  // The list merge of other fields matches unkeyed items by value: among empty cells it moved the word a column.
  assert.deepEqual(mergeCells3(['', '', ''], ['', 'mine', ''], ['theirs', '', '']), ['theirs', 'mine', ''])
  // Both in one cell: merged as a text field's.
  assert.deepEqual(mergeCells3(['one two'], ['one two three'], ['zero one two']), ['zero one two three'])
})

test('a column added or removed while I type: my cell follows its column, and the row keeps the table\'s width', () => {
  const before = [row('a', 'A1', '', 'A3'), row('b', 'B1', 'B2', 'B3')]
  const inserted = [row('a', 'A1', '', '', 'A3'), row('b', 'B1', '', 'B2', 'B3')]
  // I typed in the empty middle cell of row a; they put a column before it. Row b says which is which.
  assert.deepEqual(mergeCells3(['A1', '', 'A3'], ['A1', 'mine', 'A3'], ['A1', '', '', 'A3'], before, inserted), ['A1', '', 'mine', 'A3'])
  // They removed the column I typed in: my text goes with it, the row is as short as the rest.
  assert.deepEqual(mergeCells3(['A1', '', 'A3'], ['A1', 'mine', 'A3'], ['A1', 'A3'], before, [row('a', 'A1', 'A3'), row('b', 'B1', 'B3')]), ['A1', 'A3'])
  // They removed another one: mine moves left with its column.
  assert.deepEqual(mergeCells3(['A1', '', 'A3'], ['A1', '', 'mine'], ['', 'A3'], before, [row('a', '', 'A3'), row('b', 'B2', 'B3')]), ['', 'mine'])
  // Through the save queue's door: only a table's lists are taken.
  const doc = (rows: unknown[]) => ({chart: table(...rows)})
  assert.deepEqual(mergeTablePart('chart.rows[_key=="a"].cells', ['A1', '', 'A3'], ['A1', 'mine', 'A3'], ['A1', '', '', 'A3'], doc(before), doc(inserted)), ['A1', '', 'mine', 'A3'])
  assert.equal(mergeTablePart('tags', ['a'], ['a', 'b'], ['c'], {}, {tags: ['c']}), null)
  assert.equal(mergeTablePart('list.rows', [], [], [], {}, {list: {rows: []}}), null)
})

test('rows set whole (my column, row or paste) onto theirs: their typing, rows and columns stay; no row ends shorter', () => {
  const base = [row('a', 'A1', 'A2'), row('b', 'B1', 'B2')]
  // I add a column in the middle; they type in B2 and add a row meanwhile.
  const mine = [row('a', 'A1', '', 'A2'), row('b', 'B1', '', 'B2')]
  const theirs = [row('a', 'A1', 'A2'), row('b', 'B1', 'B2 typed'), row('c', 'C1', 'C2')]
  assert.deepEqual(mergeRows3(base, mine, theirs), [row('a', 'A1', '', 'A2'), row('b', 'B1', '', 'B2 typed'), row('c', 'C1', '', 'C2')])
  // I add a row; they remove the first column: my row is as wide as theirs.
  assert.deepEqual(mergeRows3(base, [...base, row('n', '', '')], [row('a', 'A2'), row('b', 'B2')]), [row('a', 'A2'), row('b', 'B2'), row('n', '')])
  // I remove a row they typed in: it is gone, no ghost of it.
  assert.deepEqual(mergeRows3(base, [base[0]], [row('a', 'A1', 'A2'), row('b', 'B1!', 'B2')]), [row('a', 'A1', 'A2')])
  // I move a row while they type: my order, their text.
  assert.deepEqual(mergeRows3(base, [base[1], base[0]], [row('a', 'A1!', 'A2'), base[1]]), [base[1], row('a', 'A1!', 'A2')])
  // Both add a column at the end at once: two columns. My own column, saved and come back, is one.
  assert.deepEqual(mergeRows3(base, [row('a', 'A1', 'A2', 'm'), row('b', 'B1', 'B2', '')], [row('a', 'A1', 'A2', 't'), row('b', 'B1', 'B2', '')]), [row('a', 'A1', 'A2', 'm', 't'), row('b', 'B1', 'B2', '', '')])
  assert.deepEqual(mergeRows3(base, [row('a', 'A1', 'A2', ''), row('b', 'B1', 'B2', 'typed since')], [row('a', 'A1', 'A2', ''), row('b', 'B1', 'B2', '')]), [row('a', 'A1', 'A2', ''), row('b', 'B1', 'B2', 'typed since')])
  // A row of theirs I did not touch stays exactly as stored (an import's extra keys, its short row).
  const odd = {_type: 'my-row', _key: 'b', cells: ['B1'], note: 1}
  assert.equal(mergeRows3([base[0], odd], [row('a', 'A1!', 'A2'), odd], [base[0], odd])![1], odd)
  // Not rows of a table: the caller's own merge.
  assert.equal(mergeRows3([{_key: 'a'}], [{_key: 'a'}], [{_key: 'a'}]), null)
})

test('a Portable Text table (keyed cells of blocks) is not ours to merge: its rows and cells go to the list merge, as on main', () => {
  // lib/pt-table.ts's shape: the same `_type: 'table'` and `rows`, each cell a keyed object.
  const blk = (k: string, text: string) => ({_type: 'block', _key: `${k}b`, style: 'normal', markDefs: [], children: [{_type: 'span', _key: `${k}s`, text, marks: []}]})
  const cell = (k: string, text: string) => ({_type: 'cell', _key: k, value: [blk(k, text)]})
  const prow = (k: string, ...cells: ReturnType<typeof cell>[]) => ({_type: 'row', _key: k, cells})
  const rows = [prow('r1', cell('a', 'A1'), cell('b', 'B1')), prow('r2', cell('c', 'C1'), cell('d', 'D1'))]
  const doc = (r: unknown[]) => ({body: [{_type: 'table', _key: 't', rows: r}]})
  const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
  // I add a row while they type in a cell (a reload's kept edit: separate objects).
  const theirs = copy(rows)
  theirs[0]!.cells[1]!.value[0]!.children[0]!.text = 'B1 THEIRS'
  assert.equal(mergeTablePart('body[_key=="t"].rows', copy(rows), [...copy(rows), prow('r3', cell('e', ''))], theirs, doc(copy(rows)), doc(theirs)), null)
  // I remove a cell of r1 while they add one at its start (the cache's shared objects).
  const r1 = rows[0]!.cells
  const added = [cell('n', 'NEW'), ...copy(r1)]
  const now = copy(rows)
  now[0]!.cells = added
  assert.equal(mergeTablePart('body[_key=="t"].rows[_key=="r1"].cells', [...r1], [r1[0]], added, doc(rows), doc(now)), null)
  // Nor a preview's table.
  assert.equal(isTableValue({_type: 'table', rows}), false)
})

test('caret follow: a removed column that reads like its neighbour is read as gone, never followed into the neighbour', () => {
  // 3 × 3, the first two columns alike; the other editor removed column 0, my caret was in it (row 0).
  const was = [['x', 'x', ''], ['x', 'x', 'x'], ['', '', '']]
  const now = [['x', ''], ['x', 'x'], ['', '']]
  const rows = was.map((r, i): [string[], string[]] => [r, now[i]!])
  assert.equal(caretColumn(rows, 3, 2, 0), -1)
  assert.equal(caretColumn(rows, 3, 2, 1), -1)
  // The cells say which went: the caret follows.
  const distinct = [['ae', 'af', 'ag'], ['be', 'bf', 'bg']]
  const after = distinct.map((r): [string[], string[]] => [r, [r[0]!, r[2]!]])
  assert.deepEqual([0, 1, 2].map((c) => caretColumn(after, 3, 2, c)), [0, -1, 1])
  // An added column: the caret goes on in its own.
  assert.equal(caretColumn(distinct.map((r): [string[], string[]] => [r, ['', ...r]]), 3, 4, 1), 2)
})

test('caret follow, alike either way: the caret goes on in its own text where that stands in its row now, else it is gone', () => {
  // 2 × 2 alike, column 0 removed; my word in row 1 column 1, its first keys saved (or all of it).
  const rows = (now1: string): [string[], string[]][] => [[['x', 'x<T5>'], ['x']], [['x<', 'x<U5>'], [now1]]]
  assert.equal(caretColumn(rows('x<U5>'), 2, 1, 1, 1), 0)
  assert.equal(caretColumn(rows('x<U'), 2, 1, 1, 1), 0)
  assert.equal(caretColumn(rows('x'), 2, 1, 1, 1), -1)
  // Nothing typed: an alike text is no one's own; read as gone, not followed.
  assert.equal(caretColumn([[['x', 'x'], ['x']]], 2, 1, 1, 0), -1)
})

test('a key from the old grid after a removal that reads alike either way: no column (the caret takes it to the card), never into the other editor\'s saved cell', () => {
  // Review 7, seed 63018 #136: every cell 'x', my '<' saved in column 1; they typed '<P6>' in
  // column 0, removed column 1 and saved. My next key comes from the old grid's input.
  assert.equal(columnNow(['x', 'x<'], 2, ['x<P6>'], 1, 'x<T', 'x<'), -1)
  // The cells say which went: the key follows its column.
  assert.equal(columnNow(['ae', 'af', 'ag'], 3, ['ae', 'ag'], 2, 'ag!', 'ag'), 1)
})
