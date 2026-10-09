// B12: desk URLs read against a declared desk, Sanity-style, and print back unchanged.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {deskSort, listFilter, normalizeDesk, parseDeskPanes, unsupportedOps} from './desk.ts'
import {panesPath} from './panes.ts'

// The shape GET /v1/structure returns for the Agency twin, cut down.
const desk = normalizeDesk({
  id: 'root',
  type: 'list',
  items: [
    {id: 'forside', type: 'document', title: 'Forside', typeName: 'frontpage', docId: 'frontpage'},
    {id: 'desk-1', type: 'divider'},
    {
      id: 'utgivelser',
      type: 'list',
      title: 'Utgivelser',
      items: [
        {id: 'alle-utgivelser', type: 'document_type_list', typeName: 'publication', orderings: [{field: 'title', direction: 'asc'}]},
        {id: 'uten-omslag', type: 'document_type_list', typeName: 'publication', filter: {'content.cover.assetId': {is: 'null'}}},
      ],
    },
    {
      id: 'kategorier',
      type: 'list',
      items: [
        {id: 'hierarkisk-struktur', type: 'document_type_list', typeName: 'category', tree: {parent: 'content.parent'}, filter: {'content.parent': {is: 'null'}}},
        {id: 'uten-utgivelser', type: 'document_type_list', typeName: 'category', filter: {_id: {notReferencedBy: 'publication'}}},
      ],
    },
    {id: 'desk-9', type: 'divider'},
    {id: 'plugin-link-1', type: 'plugin_link', title: 'Fleet', filter: '/admin/fleet'},
  ],
})

const round = (url: string) => panesPath(parseDeskPanes(url.replace('/structure/', ''), desk))

test('desk URLs round-trip', () => {
  for (const url of [
    '/structure/forside',
    '/structure/forside|,view=json',
    '/structure/utgivelser',
    '/structure/utgivelser;uten-omslag',
    '/structure/utgivelser;alle-utgivelser;pub-1',
    '/structure/utgivelser;alle-utgivelser;pub-1;author-1,type=author,parentRefPath=author',
    '/structure/kategorier;hierarkisk-struktur;cat-1',
    '/structure/kategorier;hierarkisk-struktur;cat-1;cat-2',
    '/structure/kategorier;hierarkisk-struktur;cat-1;cat-2;cat-2',
  ])
    assert.equal(round(url), url)
})

test('a singleton segment opens its pinned doc', () => {
  const [, doc] = parseDeskPanes('forside', desk)
  assert.deepEqual(doc, {kind: 'doc', id: 'frontpage', type: 'frontpage', node: 'forside', parentRefPath: undefined, view: undefined, inspect: undefined, rev: undefined, path: undefined, sibling: undefined})
})

test('in a tree, an id opens its children and the same id again opens the doc', () => {
  const panes = parseDeskPanes('kategorier;hierarkisk-struktur;cat-1;cat-1', desk)
  assert.deepEqual(
    panes.map((p) => p.kind),
    ['types', 'menu', 'list', 'list', 'doc'],
  )
  assert.equal((panes[3] as {treeParent?: string}).treeParent, 'cat-1')
  assert.equal((panes[4] as {id: string}).id, 'cat-1')
})

test('a type name or unknown first segment reads as before (search, old links)', () => {
  assert.deepEqual(parseDeskPanes('publication;pub-1', desk).map((p) => p.kind), ['types', 'list', 'doc'])
})

test('plugin links and the dividers they leave go', () => {
  assert.deepEqual(desk.items?.map((i) => i.id), ['forside', 'desk-1', 'utgivelser', 'kategorier'])
})

test('filters, tree levels, ops the query API lacks, and orderings', () => {
  const kat = desk.items?.find((i) => i.id === 'kategorier')!
  const [tree, unref] = kat.items ?? []
  assert.deepEqual(listFilter(tree), {'content.parent': {is: 'null'}})
  assert.deepEqual(listFilter(tree, 'cat-1'), {'content.parent': {eq: 'cat-1'}})
  assert.deepEqual(unsupportedOps(unref.filter), [])
  assert.deepEqual(unsupportedOps({_id: {madeUpOp: 'x'}}), ['madeUpOp'])
  assert.deepEqual(unsupportedOps(tree.filter), [])
  assert.equal(deskSort(desk.items?.[2].items?.[0]), 'title')
  assert.equal(deskSort(tree), undefined)
  // J55: a declared order the menu has no name for still opens as declared.
  assert.equal(deskSort({...tree, orderings: [{field: 'year', direction: 'desc'}, {field: 'title', direction: 'asc'}]}), 'year:desc,title:asc')
})
