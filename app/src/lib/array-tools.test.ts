import {test} from 'node:test'
import assert from 'node:assert/strict'
import type {Field} from './data.ts'
import {ALL_ITEMS, filterChoices, gridStep, menuSetup, previewUrl} from './insert-menu.ts'
import {filterTree, itemLimit, itemsAbove, treeOf, treeRows, type TreeNode} from './array-tree.ts'

// Array power tools: the insert menu's filter, views and grid keys; long arrays folding as
// Sanity's (4 in a list, 8 in a grid); and the nested item dialog's tree.

const kinds = [
  {value: 'hero', title: 'Hero'},
  {value: 'quote', title: 'Quote'},
  {value: 'cta', title: 'Call to action'},
  {value: 'stat', title: 'Stat'},
  {value: 'faq', title: 'FAQ'},
  {value: 'logo', title: 'Logo strip'},
]

test('insert menu: a search past five types, filtered by title as you type; groups and views from options.insertMenu', () => {
  // No options: Sanity's 'auto' (a box past five types), a list, icons on.
  assert.deepEqual(menuSetup(undefined, 6), {filter: true, groups: [], views: ['list'], showIcons: true})
  assert.equal(menuSetup({}, 5).filter, false)
  assert.deepEqual(filterChoices(kinds, ' fa ').map((c) => c.value), ['faq'])
  assert.deepEqual(filterChoices(kinds, 'O').map((c) => c.value), ['hero', 'quote', 'cta', 'logo'])
  assert.deepEqual(filterChoices(kinds, 'zzz'), [])
  const setup = menuSetup({insertMenu: {filter: false, showIcons: false, groups: [{name: 'intro', title: 'Intro', of: ['hero', 'quote']}, {name: 'proof'}], views: [{name: 'list'}, {name: 'grid', previewImageUrl: '/static/blocks/{type}.png'}]}}, 6, 'Alle')
  assert.deepEqual(setup.groups.map((g) => [g.name, g.title]), [[ALL_ITEMS, 'Alle'], ['intro', 'Intro'], ['proof', 'Proof']])
  assert.deepEqual(setup.views, ['list', 'grid'])
  assert.equal(setup.filter, false)
  assert.equal(setup.showIcons, false)
  // A group narrows, and the query narrows within it.
  assert.deepEqual(filterChoices(kinds, '', setup.groups[1]).map((c) => c.value), ['hero', 'quote'])
  assert.deepEqual(filterChoices(kinds, 'q', setup.groups[1]).map((c) => c.value), ['quote'])
  assert.deepEqual(filterChoices(kinds, '', setup.groups[2]), [])
  assert.equal(previewUrl(setup.preview, 'call to'), '/static/blocks/call%20to.png')
  assert.equal(previewUrl(undefined, 'hero'), undefined)
})

test('insert menu grid: arrows move by tile and by row, stopping at the edges', () => {
  // 6 tiles, 4 to a row: 0 1 2 3 / 4 5
  assert.equal(gridStep(-1, 'ArrowDown', 6, 4), 0)
  assert.equal(gridStep(-1, 'ArrowUp', 6, 4), 5)
  assert.equal(gridStep(1, 'ArrowDown', 6, 4), 5)
  assert.equal(gridStep(2, 'ArrowDown', 6, 4), 2)
  assert.equal(gridStep(5, 'ArrowUp', 6, 4), 1)
  assert.equal(gridStep(5, 'ArrowRight', 6, 4), 0)
  assert.equal(gridStep(0, 'ArrowLeft', 6, 4), 5)
  assert.equal(gridStep(3, 'End', 6, 4), 5)
  assert.equal(gridStep(3, 'Home', 6, 4), 0)
})

test("long arrays fold after Sanity's 4 (8 in a grid); collapseItemsAfter wins, false never folds", () => {
  assert.equal(itemLimit(undefined), 4)
  assert.equal(itemLimit({}, true), 8)
  assert.equal(itemLimit({collapseItemsAfter: 10}), 10)
  assert.equal(itemLimit({collapseItemsAfter: false}), Infinity)
  // Not a whole number above 0: the default, as Sanity's.
  assert.equal(itemLimit({collapseItemsAfter: 2.5}), 4)
  assert.equal(itemLimit({collapseItemsAfter: 0}, true), 8)
})

// fieldTypes' sections: items inside items (fixtures/barkpark-schema/fieldTypes.json), plus an
// object around a second array to show the tree reads through objects.
const item: Field = {name: 'item', type: 'composite', fields: [{name: 'label', type: 'string'}]}
const section: Field = {name: 'section', type: 'composite', fields: [{name: 'title', type: 'string'}, {name: 'items', type: 'arrayOf', of: item}, {name: 'more', type: 'composite', fields: [{name: 'extra', type: 'arrayOf', of: item}]}]}
const sections = {of: section}
const title = (it: Record<string, unknown>) => String(it.title ?? it.label ?? 'Untitled')
const value = [
  {_key: 'a', title: 'Intro', items: [{_key: 'a1', label: 'Hello'}, {_key: 'a2', label: 'World'}]},
  {_key: 'b', title: 'Pricing', more: {extra: [{_key: 'b1', label: 'Gold plan'}]}},
  {_key: 'c', title: 'Footer'},
]

test('tree: every item with the items of arrays inside it, by path, through plain objects', () => {
  const tree = treeOf('sections', sections, value, title)
  const flat = (ns: TreeNode[]): string[] => ns.flatMap((n) => [`${n.path} #${n.position} ${n.title}`, ...flat(n.children)])
  assert.deepEqual(flat(tree), [
    'sections[_key=="a"] #1 Intro',
    'sections[_key=="a"].items[_key=="a1"] #1 Hello',
    'sections[_key=="a"].items[_key=="a2"] #2 World',
    'sections[_key=="b"] #2 Pricing',
    'sections[_key=="b"].more.extra[_key=="b1"] #1 Gold plan',
    'sections[_key=="c"] #3 Footer',
  ])
  // Search keeps the matches and the way down to them.
  assert.deepEqual(flat(filterTree(tree, 'gold')), ['sections[_key=="b"] #2 Pricing', 'sections[_key=="b"].more.extra[_key=="b1"] #1 Gold plan'])
  assert.deepEqual(filterTree(tree, 'nothing'), [])
  // Rows: an item's children show while it is open.
  const rows = treeRows(tree, (p) => p === 'sections[_key=="a"]')
  assert.deepEqual(rows.map((r) => `${r.depth}:${r.node.key}`), ['0:a', '1:a1', '1:a2', '0:b', '0:c'])
  assert.equal(rows[1]!.parent, 'sections[_key=="a"]')
  assert.deepEqual(itemsAbove('sections[_key=="b"].more.extra[_key=="b1"]'), ['sections[_key=="b"]'])
})

test('tree: an edit to one item of 300 rebuilds that node only; a move renumbers', () => {
  const big = Array.from({length: 300}, (_, i) => ({_key: `r${i}`, title: `Row ${i}`}))
  const cache = new WeakMap()
  let calls = 0
  const counted = (it: Record<string, unknown>) => (calls++, title(it))
  const first = treeOf('rows', sections, big, counted, cache)
  assert.equal(calls, 300)
  const edited = big.map((r, i) => (i === 299 ? {...r, title: 'Row 299 edited'} : r))
  const second = treeOf('rows', sections, edited, counted, cache)
  assert.equal(calls, 301)
  assert.equal(second[0], first[0])
  assert.equal(second[299]!.title, 'Row 299 edited')
  const moved = [edited[1]!, edited[0]!, ...edited.slice(2)]
  const third = treeOf('rows', sections, moved, counted, cache)
  assert.deepEqual([third[0]!.key, third[0]!.position, third[1]!.key, third[1]!.position], ['r1', 1, 'r0', 2])
  assert.equal(third[2], second[2])
})
