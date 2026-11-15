// Tables in a Portable Text field (node --test): the value's shape, what a save sends for a
// cell, and two editors in one table. Made-up content only (the repo is public).
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {applyPatches, parsePatch} from '@sanity/diff-match-patch'
import {isTable, tableEdits, tablesIn, tableText} from './pt-table.ts'
import {asEditorHolds, caretOf, editorSchema, freshItems, insertable, mergeValue, remoteBlockPatches, spanAt, spanTexts, textPatches, withRemote, type PtBlock} from './pt-value.ts'
import {getPath, mergePending, setInside, setPath} from './paths.ts'
import {mergeList3} from './merge.ts'
import {ptChanges} from './pt-diff.ts'
import {blockPoint} from './pt-comment-ranges.ts'

// A table as Sanity Studio 6.17 stores one (its @portabletext/plugin-table): 12-hex keys, a
// header row, a cell holding blocks. The second cell's block has no style or markDefs, and a
// key the editor is never told (`note`), as an import may leave them.
const SANITY_TABLE = (): PtBlock => ({
  _key: '9f2c1a7b3d4e',
  _type: 'table',
  headerRows: 1,
  rows: [
    {_key: 'a1b2c3d4e5f6', _type: 'row', cells: [
      {_key: 'c0ffee000001', _type: 'cell', value: [{_key: 'b10000000001', _type: 'block', style: 'normal', markDefs: [], children: [{_key: 's10000000001', _type: 'span', marks: ['strong'], text: 'Tea'}]}]},
      {_key: 'c0ffee000002', _type: 'cell', note: 'kept', value: [{_key: 'b10000000002', _type: 'block', children: [{_key: 's10000000002', _type: 'span', text: 'Minutes'}]}]},
    ]},
    {_key: 'a1b2c3d4e5f7', _type: 'row', cells: [
      {_key: 'c0ffee000003', _type: 'cell', value: [{_key: 'b10000000003', _type: 'block', style: 'normal', markDefs: [], children: [{_key: 's10000000003', _type: 'span', marks: [], text: 'Green'}]}]},
      {_key: 'c0ffee000004', _type: 'cell', value: [{_key: 'b10000000004', _type: 'block', style: 'normal', markDefs: [], children: [{_key: 's10000000004', _type: 'span', marks: [], text: 'three'}]}]},
    ]},
  ],
})
const para = (key: string, text: string): PtBlock => ({_key: key, _type: 'block', style: 'normal', markDefs: [], children: [{_key: `${key}s`, _type: 'span', marks: [], text}]})
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
/** What the editor makes of a value: every text block's defaults filled in, the cells' too. */
const reading = (value: PtBlock[]) => value.map((b) => asEditorHolds(clone(b)) as PtBlock)
/** `value` with the text of the span at `path` (from the field) set. */
const retext = (value: PtBlock[], path: string, text: string) => setPath({v: value}, `v${path}`, text).v as PtBlock[]
const SPAN = (row: string, cell: string, block: string, span: string) => `[_key=="9f2c1a7b3d4e"].rows[_key=="${row}"].cells[_key=="${cell}"].value[_key=="${block}"].children[_key=="${span}"].text`
const GREEN = SPAN('a1b2c3d4e5f7', 'c0ffee000003', 'b10000000003', 's10000000003')
const THREE = SPAN('a1b2c3d4e5f7', 'c0ffee000004', 'b10000000004', 's10000000004')

test('a table is rows of cells of blocks; a field takes tables when it declares one or its text holds one', () => {
  assert.equal(isTable(SANITY_TABLE()), true)
  // Another plugin's table (cells are strings): not ours, and it stays the card it was.
  const other = {_key: 't', _type: 'table', rows: [{_key: 'r', _type: 'tableRow', cells: ['a', 'b']}]}
  assert.equal(isTable(other), false)
  assert.deepEqual(tablesIn({blocks: {of: ['image', 'table']}}, []), {on: true, declared: true})
  assert.deepEqual(tablesIn({}, [para('p', 'x'), SANITY_TABLE()]), {on: true, declared: false})
  assert.deepEqual(tablesIn({blocks: {of: ['table']}}, [other]), {on: false, declared: true})
  // A custom block named table with fields of its own is that block, not a grid.
  assert.equal(tablesIn({blocks: {of: [{name: 'table', fields: [{name: 'caption', type: 'string'}]}]}}, []).on, false)
  // A field that does not allow tables, with none in its text: nothing changes for it.
  assert.deepEqual(tablesIn({blocks: {of: ['image']}}, [para('p', 'x')]), {on: false, declared: false})
  assert.equal(editorSchema({blocks: {of: ['image']}}, [para('p', 'x')]).blockObjects.some((b) => b.name === 'table'), false)
  assert.deepEqual(insertable({blocks: {of: ['image']}}, false).blocks, [{name: 'image'}])
  // Told to the editor whole (rows, cells, their text), so it edits inside it; a held table is offered again.
  const table = editorSchema({}, [SANITY_TABLE()]).blockObjects.find((b) => b.name === 'table')!
  assert.deepEqual(table.fields!.map((f) => [f.name, f.type]), [['headerRows', 'number'], ['rows', 'array']])
  assert.deepEqual(insertable({}, true).blocks, [{name: 'table'}])
  assert.equal(tableText(SANITY_TABLE()), 'Tea\tMinutes\nGreen\tthree')
})

test('a Sanity table opened and saved: untouched it goes back byte for byte; one cell typed in changes that span only', () => {
  const stored = [para('p1', 'Before'), SANITY_TABLE()]
  const seen = reading(stored)
  assert.deepEqual(mergeValue(stored, seen, reading(stored)), stored)
  assert.equal(mergeValue(stored, seen, reading(stored))[1], stored[1])
  const next = retext(reading(stored), GREEN, 'Green tea')
  const saved = mergeValue(stored, seen, next)
  assert.equal(getPath({v: saved}, `v${GREEN}`), 'Green tea')
  // Every other row and cell is the stored object itself: no style or markDefs filled in, the unknown key kept.
  const [was, now] = [stored[1] as never as {rows: {cells: unknown[]}[]}, saved[1] as never as {rows: {cells: unknown[]}[]}]
  assert.equal(now.rows[0], was.rows[0])
  assert.equal(now.rows[1]!.cells[1], was.rows[1]!.cells[1])
  assert.deepEqual(JSON.parse(JSON.stringify(saved).replace('Green tea', 'Green')), stored)
})

test('typing in a cell goes as a patch on that span\'s keyed path; any other nested path is not typing', () => {
  const path = [{_key: 't'}, 'rows', {_key: 'r'}, 'cells', {_key: 'c'}, 'value', {_key: 'b'}, 'children', {_key: 's'}, 'text']
  assert.deepEqual(spanAt(path), {block: 't', span: 's', at: 't/r/c/b/s', path: '[_key=="t"].rows[_key=="r"].cells[_key=="c"].value[_key=="b"].children[_key=="s"].text', inBlock: '[_key=="t"].rows[_key=="r"].cells[_key=="c"].value[_key=="b"]'})
  assert.equal(spanAt([{_key: 'b'}, 'children', {_key: 's'}, 'text'])!.path, '[_key=="b"].children[_key=="s"].text')
  // Not a span's text, a field of another name on the way, or a key a path cannot hold: never sent as a patch.
  assert.equal(spanAt(path.slice(0, 9)), null)
  assert.equal(spanAt(path.map((s) => (s === 'cells' ? 'items' : s))), null)
  assert.equal(spanAt(path.map((s) => (typeof s === 'object' && s._key === 'c' ? {_key: 'c"]'} : s))), null)
  assert.equal(spanAt([{_key: 't'}, 'rows', {_key: 'r'}, 'text']), null)
  const typed = textPatches([{type: 'diffMatchPatch', path, value: '@@ -1,5 +1,9 @@\n Green\n+ tea\n'}])!
  assert.equal(typed[0]!.path, spanAt(path)!.path)
  assert.equal(textPatches([{type: 'diffMatchPatch', path, value: 'x'}, {type: 'insert', path: [{_key: 't'}, 'rows', {_key: 'r'}], items: []}]), null)
  // The spans of a value, the cells' too, each by the name a patch for it carries.
  assert.deepEqual(spanTexts([para('p1', 'Before'), SANITY_TABLE()]).map(([at]) => at.split('/').length), [2, 5, 5, 5, 5])
  // A caret in a cell is not one presence (or an inline comment) can place: none, never the wrong block.
  const inCell = {path: path.slice(0, 9), offset: 2}
  assert.equal(caretOf({anchor: inCell, focus: inCell}), null)
  assert.equal(blockPoint([SANITY_TABLE()], caretOf({anchor: inCell, focus: inCell})?.head), null)
})

test('a table\'s change is sent as the smallest spots: a cell\'s block, a cell\'s blocks, a row\'s cells, the rows', () => {
  const was = SANITY_TABLE()
  const block = '.rows[_key=="a1b2c3d4e5f7"].cells[_key=="c0ffee000003"].value[_key=="b10000000003"]'
  // A word made bold in one cell: that block, no other cell in what is sent.
  const bold = setPath({v: clone(was)}, `v${block}.children`, [{_key: 's10000000003', _type: 'span', marks: ['strong'], text: 'Green'}]).v
  assert.deepEqual(tableEdits(was, bold)!.map((e) => e.path), [block])
  // Enter in a cell: that cell's blocks.
  const cellValue = '.rows[_key=="a1b2c3d4e5f7"].cells[_key=="c0ffee000003"].value'
  const two = setPath({v: clone(was)}, `v${cellValue}`, [...(getPath({v: was}, `v${cellValue}`) as unknown[]), para('n1', 'second')]).v
  assert.deepEqual(tableEdits(was, two)!.map((e) => e.path), [cellValue])
  // A row added: the rows. A column added: each row's cells. The header row: its own field.
  const cell = (k: string) => ({_key: k, _type: 'cell', value: [para(`${k}b`, '')]})
  const rows = was.rows as {_key: string; cells: unknown[]}[]
  assert.deepEqual(tableEdits(was, {...was, rows: [...rows, {_key: 'r3', _type: 'row', cells: [cell('x1'), cell('x2')]}]})!.map((e) => e.path), ['.rows'])
  assert.deepEqual(tableEdits(was, {...was, rows: rows.map((r, i) => ({...r, cells: [...r.cells, cell(`n${i}`)]}))})!.map((e) => e.path), ['.rows[_key=="a1b2c3d4e5f6"].cells', '.rows[_key=="a1b2c3d4e5f7"].cells'])
  assert.deepEqual(tableEdits(was, {...was, headerRows: 0}), [{path: '.headerRows', value: 0}])
  const {headerRows: _, ...plain} = was
  assert.deepEqual(tableEdits(was, plain), [{path: '.headerRows', value: undefined}])
  assert.deepEqual(tableEdits(was, clone(was)), [])
  // A row without a key (or not a table): the block goes whole.
  assert.equal(tableEdits(was, {...was, rows: [...rows, {_type: 'row', cells: []}]}), null)
  assert.equal(tableEdits(para('p', 'x'), was), null)
})

test('two editors in one table: their words in another cell come in as a patch there, their new row as a row, while this editor types', () => {
  const known = [para('p1', 'Before'), SANITY_TABLE()]
  // This editor has typed in "Green"; they typed in "three" and added a row.
  const shown = retext(reading(known), GREEN, 'Green tea')
  const row = {_key: 'a1b2c3d4e5f8', _type: 'row', cells: [{_key: 'c0ffee000005', _type: 'cell', value: [para('b5', 'Black')]}, {_key: 'c0ffee000006', _type: 'cell', value: [para('b6', 'five')]}]}
  let incoming = retext(clone(known), THREE, 'three or four')
  incoming = setPath({v: incoming}, 'v[_key=="9f2c1a7b3d4e"].rows', [...((incoming[1] as never as {rows: unknown[]}).rows), row]).v as PtBlock[]
  const seen = new Map<string, string>()
  const patches = remoteBlockPatches(known, incoming, shown, [], new Set(), seen)
  const three = [{_key: '9f2c1a7b3d4e'}, 'rows', {_key: 'a1b2c3d4e5f7'}, 'cells', {_key: 'c0ffee000004'}, 'value', {_key: 'b10000000004'}, 'children', {_key: 's10000000004'}, 'text']
  assert.deepEqual(patches.map((p) => [p.type, p.path]), [['diffMatchPatch', three], ['insert', [{_key: '9f2c1a7b3d4e'}, 'rows', {_key: 'a1b2c3d4e5f7'}]]])
  assert.equal(applyPatches(parsePatch((patches[0] as {value: string}).value), 'three')[0], 'three or four')
  assert.equal(seen.get('9f2c1a7b3d4e/a1b2c3d4e5f7/c0ffee000004/b10000000004/s10000000004'), 'three or four')
  // Nothing of theirs lands on the cell this editor is typing in; its own text is not given back to it.
  assert.equal(patches.some((p) => JSON.stringify(p.path).includes('c0ffee000003')), false)
  // What this editor holds after them (its own typing aside): their row in place.
  assert.deepEqual((withRemote(shown, patches)[1] as never as {rows: {_key: string}[]}).rows.map((r) => r._key), ['a1b2c3d4e5f6', 'a1b2c3d4e5f7', 'a1b2c3d4e5f8'])
  // The header row switched off there, and a row removed there: this editor's table follows.
  const off = clone(known)
  ;(off[1] as PtBlock).headerRows = 0
  ;(off[1] as never as {rows: unknown[]}).rows.shift()
  assert.deepEqual(remoteBlockPatches(known, off, shown).map((p) => [p.type, p.path]), [['set', [{_key: '9f2c1a7b3d4e'}, 'headerRows']], ['unset', [{_key: '9f2c1a7b3d4e'}, 'rows', {_key: 'a1b2c3d4e5f6'}]]])
  assert.equal((withRemote(shown, remoteBlockPatches(known, off, shown))[1] as PtBlock).headerRows, 0)
})

test('a row or a column added is saved onto the rows as held now: another editor\'s newest words in the other cells stay', () => {
  const prior = (SANITY_TABLE().rows as {_key: string}[])
  const mine = [...prior, {_key: 'new', _type: 'row', cells: []}]
  // Held now: the other editor has typed in "three" since this editor last drew it, and added a row of their own.
  const now = (retext([SANITY_TABLE()], THREE, 'three or four')[0] as never as {rows: {_key: string}[]}).rows
  const held = [...now, {_key: 'theirs', _type: 'row', cells: []}]
  const sent = freshItems(prior, mine, held) as {_key: string}[]
  assert.deepEqual(sent.map((r) => r._key), ['a1b2c3d4e5f6', 'a1b2c3d4e5f7', 'theirs', 'new'])
  assert.equal(sent[1], held[1]) // their words, not this editor's older copy of the row
  // A row this editor changed itself is its own; one it removed goes.
  const edited = [{...prior[0]!, changed: true}, {_key: 'new', _type: 'row', cells: []}]
  assert.deepEqual(freshItems(prior, edited, now), edited)
  // Refused as stale and merged again (lib/edits.ts rebase): this editor's new row and its unsent
  // word in one cell, their word in another cell of the same row. Both stay.
  const base = SANITY_TABLE().rows as unknown[]
  const ours = [...(retext([SANITY_TABLE()], GREEN, 'Green tea')[0] as never as {rows: unknown[]}).rows, {_key: 'new', _type: 'row', cells: []}]
  const merged = mergeList3(base, ours, now)!
  assert.equal(getPath({v: [{_key: '9f2c1a7b3d4e', rows: merged}]}, `v${GREEN}`), 'Green tea')
  assert.equal(getPath({v: [{_key: '9f2c1a7b3d4e', rows: merged}]}, `v${THREE}`), 'three or four')
  assert.equal(merged.length, 3)
})

test('one pending write per spot: a key typed in a block pending whole goes into it; a failed save and a later whole value do not both go', () => {
  const block = {_key: 'b1', children: [{_key: 's', text: 'a'}]}
  const span = 'body[_key=="b1"].children[_key=="s"].text'
  assert.deepEqual(setInside('body[_key=="b1"]', block, span, 'ab'), {_key: 'b1', children: [{_key: 's', text: 'ab'}]})
  assert.deepEqual(setInside('seo', {title: 'a', n: 1}, 'seo.title', 'b'), {title: 'b', n: 1})
  // A span's patch did not land; meanwhile its table's rows were set whole (with that text in): the rows alone go.
  const rows = [{_key: 'r', cells: []}]
  assert.deepEqual(mergePending(new Map([[`body[_key=="t"].rows[_key=="r"].cells[_key=="c"].value[_key=="b"].children[_key=="s"].text`, 'old']]), new Map([['body[_key=="t"].rows', rows]])), {pending: new Map([['body[_key=="t"].rows', rows]]), dropped: ['body[_key=="t"].rows[_key=="r"].cells[_key=="c"].value[_key=="b"].children[_key=="s"].text']})
  // The other way round (the whole block did not land, a key typed in it since): the key goes into the block.
  assert.deepEqual(mergePending(new Map([['body[_key=="b1"]', block]]), new Map([[span, 'ab']])), {pending: new Map([['body[_key=="b1"]', {_key: 'b1', children: [{_key: 's', text: 'ab'}]}]]), dropped: [span]})
  // Spots apart stay apart.
  assert.deepEqual([...mergePending(new Map([['title', 'a']]), new Map([['slug', 'b'], ['title', 'c']])).pending], [['title', 'c'], ['slug', 'b']])
})

test('Review changes names a table\'s changed cell by its row and column, and a paragraph by its words', () => {
  const before = [para('p1', 'Before'), SANITY_TABLE(), para('p2', 'Gone')]
  const after = [para('p1', 'Before it'), retext([SANITY_TABLE()], GREEN, 'Green tea')[0]!, para('p3', 'New')]
  assert.deepEqual(ptChanges(before, after), [
    {kind: 'text', key: 'p1', change: 'changed', segments: [{kind: 'same', text: 'Before'}, {kind: 'added', text: ' it'}]},
    {kind: 'table', key: '9f2c1a7b3d4e', change: 'changed', parts: [{row: 2, column: 1, change: 'changed', segments: [{kind: 'same', text: 'Green'}, {kind: 'added', text: ' tea'}]}]},
    {kind: 'text', key: 'p3', change: 'added', segments: [{kind: 'added', text: 'New'}]},
    {kind: 'text', key: 'p2', change: 'removed', segments: [{kind: 'removed', text: 'Gone'}]},
  ])
  // A row added and a table removed: said, never an object printed.
  const grown = {...SANITY_TABLE(), rows: [...(SANITY_TABLE().rows as unknown[]), {_key: 'r3', _type: 'row', cells: [{_key: 'c9', _type: 'cell', value: [para('b9', 'Black')]}]}]}
  assert.deepEqual(ptChanges([SANITY_TABLE()], [grown]), [{kind: 'table', key: '9f2c1a7b3d4e', change: 'changed', parts: [{row: 3, change: 'added', segments: [{kind: 'added', text: 'Black'}]}]}])
  assert.equal(ptChanges([SANITY_TABLE()], [])[0]!.change, 'removed')
})
