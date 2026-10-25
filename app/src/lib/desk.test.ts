// B12: desk URLs read against a declared desk, Sanity-style, and print back unchanged.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {deskFilterParams, deskSort, listFilter, newDocPreset, normalizeDesk, paneTitleOf, parseDeskPanes, rootDesk, unsupportedOps, type DeskFilter, type DeskNode} from './desk.ts'
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
    {id: 'plugins', type: 'list', title: 'Plugins', items: [{id: 'plugin-grp-quiz', type: 'list', items: [{id: 'q', type: 'plugin_document_list'}]}]},
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

test('J18: a child list opens the docs that point at the row, then a doc of its type', () => {
  const own: DeskNode = {id: '__studio', type: 'list', items: [{id: 'posts-by-author', type: 'document_type_list', typeName: 'author', child: {typeName: 'post', field: 'author'}}]}
  const panes = parseDeskPanes('posts-by-author;author-alan;post-07', own)
  assert.deepEqual(panes.slice(1).map((p) => p.kind + ':' + ('type' in p ? p.type : '') + ':' + ('treeParent' in p ? p.treeParent ?? '' : '')), ['list:author:', 'list:post:author-alan', 'doc:post:'])
  assert.equal(panesPath(panes), '/structure/posts-by-author;author-alan;post-07')
  assert.deepEqual(listFilter(own.items![0], 'author-alan'), {author: {eq: 'author-alan'}})
})

test("B12, owner's call: a declared desk is shown exactly, without the studio's own items", () => {
  const own: DeskNode = {id: '__studio', type: 'list', items: [{id: 'posts-by-author', type: 'document_type_list', typeName: 'author'}]}
  assert.equal(rootDesk(desk, own), desk)
  assert.equal(rootDesk(null, own), own)
})

test("a declared list's paneTitle names the pane it opens; its row keeps title (Barkpark paneTitle)", () => {
  const anmeldt: DeskNode = {id: 'anmeldt', type: 'document_type_list', typeName: 'product', title: 'Med anmeldelser', paneTitle: 'Produkter med anmeldelser'}
  assert.equal(paneTitleOf(anmeldt), 'Produkter med anmeldelser')
  assert.equal(paneTitleOf({...anmeldt, paneTitle: undefined}), 'Med anmeldelser')
  assert.equal(paneTitleOf({...anmeldt, paneTitle: ''}), 'Med anmeldelser')
  assert.equal(paneTitleOf(undefined), undefined)
  // normalizeDesk keeps it on nested lists too.
  const root = normalizeDesk({id: 'root', type: 'list', items: [{id: 'u', type: 'list', title: 'Utgivelser', paneTitle: 'Alle utgivelser', items: [anmeldt]}]})
  assert.equal(paneTitleOf(root.items![0]), 'Alle utgivelser')
  assert.equal(paneTitleOf(root.items![0].items![0]), 'Produkter med anmeldelser')
})

test("a declared list's initialValues go on the document its + starts (Barkpark desk initialValues)", () => {
  const landing: DeskNode = {id: 'landingssider', type: 'document_type_list', typeName: 'page', title: 'Landingssider', initialValues: {pageType: 'landingPage'}}
  assert.deepEqual(newDocPreset(landing, false), {pageType: 'landingPage'})
  // A child list's + starts its template instead; a list without presets starts empty.
  assert.deepEqual(newDocPreset(landing, true), {})
  assert.deepEqual(newDocPreset({...landing, initialValues: undefined}, false), {})
  assert.deepEqual(newDocPreset(undefined, false), {})
  // normalizeDesk keeps it.
  const root = normalizeDesk({id: 'root', type: 'list', items: [landing]})
  assert.deepEqual(newDocPreset(root.items![0], false), {pageType: 'landingPage'})
})

test("a desk filter with neqOrMissing (GROQ's !=, Barkpark #23913) can be listed", () => {
  // «Synlige serier»: isHidden != true keeps the series without the field.
  assert.deepEqual(unsupportedOps({'content.isHidden': {neqOrMissing: true}}), [])
  assert.deepEqual(listFilter({id: 'synlige', type: 'document_type_list', typeName: 'series', filter: {'content.isHidden': {neqOrMissing: true}}}), {'content.isHidden': {neqOrMissing: true}})
})

test("a tree's own filter narrows every level below its root (Barkpark tree.filter)", () => {
  const tree: DeskNode = {
    id: 'hierarkisk',
    type: 'document_type_list',
    typeName: 'page',
    filter: {'content.pageType': {eq: 'information'}, 'content.parent': {is: 'null'}},
    tree: {parent: 'content.parent', filter: {'content.pageType': {eq: 'information'}}},
  }
  assert.deepEqual(listFilter(tree), tree.filter)
  assert.deepEqual(listFilter(tree, 'info-a'), {'content.pageType': {eq: 'information'}, 'content.parent': {eq: 'info-a'}})
  // A tree without its own filter drills as before.
  assert.deepEqual(listFilter({...tree, tree: {parent: 'content.parent'}}, 'info-a'), {'content.parent': {eq: 'info-a'}})
})

test("a tree over an array of parents drills with has, and its countEq root can be listed (Barkpark parentOp has)", () => {
  const cats: DeskNode = {
    id: 'kategorier',
    type: 'document_type_list',
    typeName: 'category',
    filter: {'content.parentCategories': {countEq: 0}},
    tree: {parent: 'content.parentCategories', op: 'has'},
  }
  assert.deepEqual(unsupportedOps(cats.filter), [])
  assert.deepEqual(listFilter(cats), {'content.parentCategories': {countEq: 0}})
  assert.deepEqual(listFilter(cats, 'c-root'), {'content.parentCategories': {has: 'c-root'}})
  // A plain tree still drills with eq.
  assert.deepEqual(listFilter({...cats, tree: {parent: 'content.parent'}}, 'c-root'), {'content.parent': {eq: 'c-root'}})
})

test("a desk filter with an $or group is sent as filter[$or][i] and can be listed (Barkpark #23981)", () => {
  // «Uten miniatyrbilde»: (!defined(onix.thumbnail) || onix.thumbnail == "").
  const missingOrEmpty: DeskFilter = {'$or': [{'content.thumbnail': {is: 'null'}}, {'content.thumbnail': {eq: ''}}], 'content.kind': {eq: 'book'}}
  assert.deepEqual(unsupportedOps(missingOrEmpty), [])
  assert.equal(
    deskFilterParams(missingOrEmpty),
    '&filter[$or][0][content.thumbnail][is]=null&filter[$or][1][content.thumbnail][eq]=&filter[content.kind][eq]=book',
  )
  // A plain filter is sent as before; an unknown op inside a branch is still caught.
  assert.equal(deskFilterParams({status: {eq: 'draft'}}), '&filter[status][eq]=draft')
  assert.deepEqual(unsupportedOps({'$or': [{x: {madeUp: 1}}]}), ['madeUp'])
})
