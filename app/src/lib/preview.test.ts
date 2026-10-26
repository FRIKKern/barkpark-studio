// J56: prepared previews, read the way Sanity's prepare in reference/sanity/schemaTypes/category.ts reads.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {firstMedia, formatPreview, iconPick, loadRefs, mediaRefs, mediaUrl, pathsOf, previewMedia, previewRefs, readPath, rowMedia, textRefs, type IconPick, type PreviewText} from './preview.ts'

const featured: PreviewText = {parts: ['featuredPost.title', 'featuredPost.publishedAt|date'], join: ' · ', empty: 'No featured post'}
const read = (values: Record<string, unknown>) => (path: string) => values[path]

test('a referenced title and a formatted date, a fallback when empty', () => {
  assert.deepEqual(previewRefs(featured), ['featuredPost'])
  assert.equal(formatPreview(featured, read({'featuredPost.title': 'Fixture post 05', 'featuredPost.publishedAt': '2026-09-06T09:00:00Z'})), 'Fixture post 05 · 06.09.2026')
  assert.equal(formatPreview(featured, read({'featuredPost.title': 'Fixture post 05'})), 'Fixture post 05')
  assert.equal(formatPreview(featured, read({})), 'No featured post')
  // A plain path, as before ("author.name"), and a date-only value.
  assert.equal(formatPreview('author.name', read({'author.name': 'Ada Lovelace'})), 'Ada Lovelace')
  assert.equal(formatPreview({parts: ['releaseDate|date']}, read({releaseDate: '2026-01-31'})), '31.01.2026')
})

test('a row\'s media: an image, an asset from elsewhere (broken-image icon), or none', () => {
  assert.deepEqual(previewMedia({asset: {_ref: 'asset-123'}}), {kind: 'image', ref: 'asset-123'})
  assert.deepEqual(previewMedia({assetId: '9', url: '/x'}), {kind: 'image', ref: 'asset-9'})
  assert.deepEqual(previewMedia({_type: 'image', asset: {_type: 'reference', _ref: 'image-0f1e-640x400-png'}, hotspot: {x: 0.5, y: 0.5, width: 1, height: 1}}), {kind: 'unsupported', source: 'image-0f1e-640x400-png'})
  const sanityRef = `image-${'0f1e'.repeat(10)}-640x400-png`
  assert.deepEqual(previewMedia({_type: 'image', asset: {_type: 'reference', _ref: sanityRef}}), {kind: 'image', ref: sanityRef})
  assert.deepEqual(previewMedia({_type: 'image', _sanityAsset: 'image@file://./images/abc-640x400.png'}), {kind: 'unsupported', source: 'image@file://./images/abc-640x400.png'})
  assert.deepEqual(previewMedia(undefined), {kind: 'none'})
  assert.deepEqual(previewMedia({}), {kind: 'none'})
})

test('a row\'s media from an image URL: drawn, an empty one skipped, the next path after it', () => {
  const spec = ['cover.thumbnail', 'cover.large']
  const url = 'https://images.example.com/covers/fixture-01.jpg'
  assert.deepEqual(previewMedia(url), {kind: 'url', src: url})
  assert.deepEqual(previewMedia(`  ${url} `), {kind: 'url', src: url})
  assert.deepEqual(previewMedia({url}), {kind: 'url', src: url})
  // Not an image URL: empty, a relative path, another scheme.
  for (const v of ['', '   ', '/covers/a.jpg', 'javascript:alert(1)', 'data:image/png;base64,AA', 'ftp://example.com/a.jpg']) assert.equal(mediaUrl(v), undefined, v)
  assert.deepEqual(previewMedia(''), {kind: 'none'})
  // The first path with a URL; an empty one gives way to the next; a single path still works.
  const both = {cover: {thumbnail: url, large: 'https://images.example.com/covers/fixture-01-large.jpg'}}
  assert.deepEqual(rowMedia(spec, both).map((c) => c.media), [{kind: 'url', src: url}, {kind: 'url', src: both.cover.large}])
  assert.deepEqual(rowMedia(spec, {cover: {thumbnail: '', large: both.cover.large}}).map((c) => c.media), [{kind: 'url', src: both.cover.large}])
  assert.deepEqual(rowMedia(spec, {cover: {thumbnail: ''}}), [])
  assert.deepEqual(rowMedia('image', {image: {asset: {_ref: 'asset-123'}}}).map((c) => c.media), [{kind: 'image', ref: 'asset-123'}])
  assert.deepEqual(rowMedia(undefined, {image: url}), [])
})

test('a row\'s media path across a reference: the image doc\'s url, once it is loaded', () => {
  const spec = 'mainImage.asset.url'
  const post = {_id: 'post-a', mainImage: {_type: 'image', asset: {_type: 'reference', _ref: 'asset-doc-1'}}}
  const assets: Record<string, unknown> = {'asset-doc-1': {_id: 'asset-doc-1', _type: 'imageAsset', url: 'https://images.example.com/a.jpg'}}
  // Not loaded yet: the id to read, and nothing to draw.
  assert.deepEqual(mediaRefs(spec, post), ['asset-doc-1'])
  assert.deepEqual(rowMedia(spec, post), [])
  // Loaded: its url draws.
  const deref = (id: string) => assets[id]
  assert.deepEqual(rowMedia(spec, post, deref).map((c) => c.media), [{kind: 'url', src: 'https://images.example.com/a.jpg'}])
  // Missing (null) or with an empty url: nothing, and the next path in the list shows.
  assert.deepEqual(rowMedia(spec, post, () => null), [])
  assert.deepEqual(rowMedia([spec, 'cover'], {...post, cover: 'https://images.example.com/b.jpg'}, () => ({url: ''})).map((c) => c.media), [{kind: 'url', src: 'https://images.example.com/b.jpg'}])
  // Two hops, a bare id on the way: each target names the next.
  const docs: Record<string, unknown> = {'author-1': {photo: {asset: {_ref: 'asset-doc-1'}}}, ...assets}
  assert.deepEqual(mediaRefs('author.photo.asset.url', {author: 'author-1'}, (id) => docs[id]), ['author-1', 'asset-doc-1'])
  assert.deepEqual(rowMedia('author.photo.asset.url', {author: 'author-1'}, (id) => docs[id]).map((c) => c.media), [{kind: 'url', src: 'https://images.example.com/a.jpg'}])
  // A path that ends on the image itself reads no doc: its asset ref is the image.
  assert.deepEqual(mediaRefs('mainImage', post), [])
})

// J33: array item previews, as Agency's feature card prepares a banner row.
test('alternatives, templates, a type title and the first image', () => {
  const title: PreviewText = {parts: [['title', 'linkedDocument.title']], empty: 'Nytt kort'}
  const subtitle: PreviewText = {parts: [['{linkedDocument._type|type}: {linkedDocument.title}', '🔗 {buttonHref}'], 'Knapp: "{buttonLabel}"'], join: ' • '}
  const opts = {typeTitle: (t: string) => ({publication: 'Utgivelse'})[t]}
  const linked = read({'linkedDocument.title': 'The Bell in the Lake', 'linkedDocument._type': 'publication', buttonHref: '/x', buttonLabel: 'Read more'})
  assert.equal(formatPreview(title, linked), 'The Bell in the Lake')
  assert.equal(formatPreview(title, read({title: 'Own', 'linkedDocument.title': 'Linked'})), 'Own')
  assert.equal(formatPreview(title, read({})), 'Nytt kort')
  assert.equal(formatPreview(subtitle, linked, opts), 'Utgivelse: The Bell in the Lake • Knapp: "Read more"')
  assert.equal(formatPreview(subtitle, read({buttonHref: '/books'})), '🔗 /books')
  // A list of alternatives as the whole spec, as a redirect row's subtitle: the first with a value.
  const alternatives: PreviewText = ['→ {toPath}', {text: '→ ?'}]
  assert.equal(formatPreview(alternatives, read({toPath: '/new'})), '→ /new')
  assert.equal(formatPreview(alternatives, read({})), '→ ?')
  assert.deepEqual(previewRefs(title, subtitle, ['backgroundImage', 'linkedDocument.cover']), ['linkedDocument'])
  const isImage = (v: unknown) => !!(v as {asset?: unknown})?.asset
  const img = {asset: {_ref: 'image-1'}}
  assert.equal(firstMedia(['backgroundImage', 'images', 'linkedDocument.cover'], read({images: [{productId: 'p'}, img]}), isImage), img)
  assert.equal(firstMedia(['backgroundImage', 'linkedDocument.cover'], read({'linkedDocument.cover': img}), isImage), img)
  assert.equal(firstMedia('backgroundImage', read({}), isImage), undefined)
})

// task-afbd6fe5a5e2085b: Barkpark's object parts (Barkpark.Content.PreviewText), read the same
// way, never throwing.
test('object parts: text, when, map, nested parts, each, and the case modifiers', () => {
  const doc = {
    pageType: 'landingPage',
    status: 'draft',
    name: 'Ada',
    role: {title: 'Writer'},
    formats: [{code: 'BB', label: 'Innbundet'}, {code: 'EB', label: 'E-bok'}, {code: 'DG'}, {_ref: 'format-x'}],
  }
  const at = (p: string) => p.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), doc)
  const spec: PreviewText = {
    parts: [
      {path: 'pageType', map: {landingPage: 'Landingsside'}},
      {when: {field: 'status', operator: 'eq', value: 'draft'}, show: {text: 'Utkast'}},
      {when: {field: 'status', operator: 'eq', value: 'published'}, show: {text: 'Publisert'}},
      {parts: ['{name} ({role.title|lower})'], join: ' '},
      {each: 'formats', show: 'label', max: 1, more: ' +'},
    ],
  }
  assert.doesNotThrow(() => formatPreview(spec, at))
  assert.equal(formatPreview(spec, at), 'Landingsside · Utkast · Ada (writer) · Innbundet +')
  // A value the map does not name shows as stored; {each} skips items with no value and references.
  assert.equal(formatPreview({parts: [{path: 'status', map: {}}]}, at), 'draft')
  assert.equal(formatPreview({parts: [{each: 'formats', show: 'code', join: '/'}]}, at), 'BB/EB/DG')
  assert.equal(formatPreview({parts: [{each: 'nothing'}], empty: 'Ingen'}, at), 'Ingen')
  assert.equal(formatPreview('name|upper', at), 'ADA')
  // The paths a spec reads, for loading references: no throw on object parts either.
  assert.deepEqual(previewRefs(spec, {parts: [{text: 'x'}, ['role.title', 'name']]}), ['role'])
})

// A category breadcrumb, as Sanity's catalogue category preview reads it: up to five parents.
const breadcrumb: PreviewText = {parts: ['parent.parent.parent.title', 'parent.parent.title', 'parent.title'], join: ' > '}

test('a three-level breadcrumb row, its targets read once per depth for the whole page', async () => {
  const store: Record<string, unknown> = {
    'cat-a1': {title: 'Alpha'},
    'cat-b1': {title: 'Beta', parent: {_ref: 'cat-a1'}},
    'cat-c1': {title: 'Gamma', parent: {_ref: 'cat-b1'}},
    'cat-a2': {title: 'North'},
    'cat-b2': {title: 'East', parent: 'cat-a2'},
    'cat-c2': {title: 'South', parent: {_ref: 'cat-b2'}},
  }
  const rows = [
    {_id: 'cat-d1', title: 'Delta', parent: {_ref: 'cat-c1'}},
    {_id: 'cat-d2', title: 'West', parent: {_ref: 'cat-c2'}},
    {_id: 'cat-d3', title: 'Top'},
  ]
  const loaded = new Map<string, unknown>()
  const deref = (id: string) => loaded.get(id)
  const subtitle = (d: unknown) => formatPreview(breadcrumb, (p) => readPath(d, p, deref), {deref})
  // Nothing loaded yet: the first depth's ids, and no breadcrumb.
  assert.deepEqual(textRefs(breadcrumb, rows[0], deref), ['cat-c1'])
  assert.equal(subtitle(rows[0]), undefined)
  const reads: string[][] = []
  await loadRefs(
    () => rows.flatMap((d) => textRefs(breadcrumb, d, deref)),
    (id) => loaded.has(id),
    async (ids) => {
      reads.push([...ids].sort())
      for (const id of ids) loaded.set(id, store[id] ?? null)
    },
  )
  // Three depths, one read each, both rows' ids in it.
  assert.deepEqual(reads, [['cat-c1', 'cat-c2'], ['cat-b1', 'cat-b2'], ['cat-a1', 'cat-a2']])
  assert.equal(subtitle(rows[0]), 'Alpha > Beta > Gamma')
  assert.equal(subtitle(rows[1]), 'North > East > South')
  assert.equal(subtitle(rows[2]), undefined)
})

test('a sixth reference reads as nothing, and a cycle stops', async () => {
  // c0 -> c1 -> ... -> c6, each a parent of the one before.
  const store: Record<string, unknown> = Object.fromEntries(Array.from({length: 7}, (_, i) => [`c${i}`, {title: `Level ${i}`, parent: i < 6 ? {_ref: `c${i + 1}`} : undefined}]))
  const deref = (id: string) => store[id]
  const row = {parent: {_ref: 'c0'}}
  assert.equal(readPath(row, 'parent.parent.parent.parent.parent.title', deref), 'Level 4')
  assert.equal(readPath(row, 'parent.parent.parent.parent.parent.parent.title', deref), undefined)
  assert.deepEqual(textRefs('parent.parent.parent.parent.parent.parent.title', row, deref), ['c0', 'c1', 'c2', 'c3', 'c4'])
  // Two categories that name each other: five hops, then nothing, and loading ends.
  const loop: Record<string, unknown> = {p: {title: 'P', parent: 'q'}, q: {title: 'Q', parent: 'p'}}
  const deep = 'parent.'.repeat(7) + 'title'
  assert.equal(readPath({parent: 'p'}, deep, (id) => loop[id]), undefined)
  let loads = 0
  const got = new Map<string, unknown>()
  await loadRefs(() => textRefs(deep, {parent: 'p'}, (id) => got.get(id)), (id) => got.has(id), async (ids) => {
    loads++
    for (const id of ids) got.set(id, loop[id])
  })
  assert.equal(loads, 2)
})

test('an `each` item that is a reference reads its target', () => {
  const docs: Record<string, unknown> = {'tag-1': {title: 'Fixture tag one'}, 'tag-2': {title: 'Fixture tag two', group: {_ref: 'group-1'}}, 'group-1': {title: 'Group'}}
  const doc = {tags: [{_ref: 'tag-1'}, {_ref: 'tag-2'}, {title: 'Inline tag'}]}
  const spec: PreviewText = {parts: [{each: 'tags', show: ['group.title', 'title']}]}
  assert.deepEqual(textRefs(spec, doc), ['tag-1', 'tag-2'])
  assert.deepEqual(textRefs(spec, doc, (id) => docs[id]), ['tag-1', 'tag-2', 'group-1'])
  const deref = (id: string) => docs[id]
  assert.equal(formatPreview(spec, (p) => readPath(doc, p, deref), {deref}), 'Fixture tag one, Group, Inline tag')
  // Without a deref (an array item's own preview), a reference item reads as nothing.
  assert.equal(formatPreview(spec, (p) => readPath(doc, p, () => undefined)), 'Inline tag')
})

// Global search reads a type's preview paths to follow references (lib/data previewRefHits).
// A subtitle of object parts once crashed it: every search across all types failed.
test('pathsOf reads the paths in object parts, fallback lists and templates', () => {
  const subtitle: PreviewText = {
    join: ' ',
    parts: [
      {text: 'by'},
      [{path: 'kind', map: {a: 'A'}}, {text: 'unknown'}],
      {when: {field: 'hidden', operator: 'eq', value: true}, show: {text: 'Hidden'}},
      {parts: ['author.name', 'editor.name|lower'], join: ', '},
      {each: 'writers', show: 'name', max: 2},
      '/{slug.current}',
    ],
  }
  assert.deepEqual(pathsOf(subtitle), ['kind', 'author.name', 'editor.name', 'writers', 'slug.current'])
  assert.deepEqual(pathsOf(['-> {target}', {text: '?'}]), ['target'])
  assert.deepEqual(pathsOf(undefined), [])
})

// task-394a39576c8fb399: Sanity's preview shows a date-time's day where the editor is,
// not its UTC day. A plain date is that day everywhere.
test('|date: a date-time is the editor\'s local day; a plain date is itself', () => {
  const tz = process.env.TZ
  try {
    process.env.TZ = 'Europe/Oslo'
    assert.equal(formatPreview({parts: ['at|date']}, read({at: '2026-10-08T23:30:00Z'})), '09.10.2026')
    assert.equal(formatPreview({parts: ['day|date']}, read({day: '2026-10-08'})), '08.10.2026')
    process.env.TZ = 'America/New_York'
    assert.equal(formatPreview({parts: ['at|date']}, read({at: '2026-10-09T02:00:00Z'})), '08.10.2026')
    assert.equal(formatPreview({parts: ['day|date']}, read({day: '2026-10-08'})), '08.10.2026')
  } finally {
    if (tz === undefined) delete process.env.TZ
    else process.env.TZ = tz
  }
})

test('|count: the items in a list, 0 when the path holds nothing, as Barkpark\'s PreviewText', () => {
  const spec: PreviewText = [{when: {field: 'packages', operator: 'count_eq', value: 1}, show: {text: '1 package'}}, '{packages|count} packages']
  assert.equal(formatPreview(spec, read({packages: [{}, {}, {}]})), '3 packages')
  assert.equal(formatPreview(spec, read({packages: [{}]})), '1 package')
  assert.equal(formatPreview(spec, read({})), '0 packages')
  assert.equal(formatPreview({parts: ['{columns} columns', '{items|count} items'], join: ' • '}, read({columns: 3, items: []})), '3 columns • 0 items')
  // A value that is not a list has no count, so its template shows nothing.
  assert.equal(formatPreview('{title|count} items', read({title: 'Fixture'})), undefined)
})

// An icon picked by a stored value (barkpark docs/contracts/list-preview.md), as a Sanity
// prepare that returns an icon component.
const kind: IconPick = {icon: {path: 'kind', map: {guide: 'compass', faq: 'help-circle', draft: null}, else: 'document', empty: 'folder'}}

test('an icon pick: the map, else for an unnamed value, empty for none, null for nothing', () => {
  assert.equal(iconPick(kind, read({kind: 'guide'})), 'compass')
  assert.equal(iconPick(kind, read({kind: 'recipe'})), 'document')
  assert.equal(iconPick(kind, read({})), 'folder')
  assert.equal(iconPick(kind, read({kind: ''})), 'folder')
  assert.equal(iconPick(kind, read({kind: 'draft'})), undefined)
  const bare: IconPick = {icon: {path: 'kind', map: {guide: 'compass'}}}
  assert.equal(iconPick(bare, read({kind: 'recipe'})), undefined)
  assert.equal(iconPick(bare, read({})), undefined)
})

test('an icon pick reads a number as its digits and takes the first path with a value', () => {
  const byCode: IconPick = {icon: {path: ['outer.code', 'code'], map: {'7': 'star'}}}
  assert.equal(iconPick(byCode, read({code: 7})), 'star')
  assert.equal(iconPick(byCode, read({'outer.code': 7, code: 1})), 'star')
})

test('row media: an image first, then the icon pick; a pick through a reference loads it', () => {
  const url = 'https://images.example.com/c.jpg'
  const spec = ['cover', kind]
  assert.deepEqual(rowMedia(spec, {cover: url, kind: 'guide'}).map((c) => c.media), [{kind: 'url', src: url}, {kind: 'icon', name: 'compass'}])
  assert.deepEqual(rowMedia(spec, {kind: 'guide'}).map((c) => c.media), [{kind: 'icon', name: 'compass'}])
  assert.deepEqual(rowMedia(spec, {kind: 'draft'}), [])
  assert.equal(firstMedia(spec, read({kind: 'guide'}), () => true), undefined)

  const viaRef: IconPick = {icon: {path: 'section.code', map: {north: 'pin'}}}
  const doc = {section: {_ref: 'sec-1'}}
  assert.deepEqual(mediaRefs(viaRef, doc), ['sec-1'])
  assert.deepEqual(pathsOf(viaRef), ['section.code'])
  const deref = (id: string) => (id === 'sec-1' ? {code: 'north'} : undefined)
  assert.deepEqual(rowMedia([viaRef], doc, deref).map((c) => c.media), [{kind: 'icon', name: 'pin'}])
})

test('|date reads a date-time in the workspace zone, whatever the browser zone', () => {
  const tz = process.env.TZ
  try {
    process.env.TZ = 'America/New_York'
    assert.equal(formatPreview('at|date', read({at: '2026-10-08T23:30:00Z'}), {zone: 'Europe/Oslo'}), '09.10.2026')
    process.env.TZ = 'Europe/Oslo'
    assert.equal(formatPreview('at|date', read({at: '2026-10-09T02:00:00Z'}), {zone: 'America/New_York'}), '08.10.2026')
    // A plain date is its own day in every zone; an unknown zone reads the browser's.
    assert.equal(formatPreview('at|date', read({at: '2026-10-08'}), {zone: 'Pacific/Kiritimati'}), '08.10.2026')
    assert.equal(formatPreview('at|date', read({at: '2026-10-08T23:30:00Z'}), {zone: 'Not/AZone'}), '09.10.2026')
  } finally {
    if (tz === undefined) delete process.env.TZ
    else process.env.TZ = tz
  }
})
