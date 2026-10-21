// J56: prepared previews, read the way Sanity's prepare in reference/sanity/schemaTypes/category.ts reads.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {firstMedia, formatPreview, mediaUrl, previewMedia, previewRefs, rowMedia, type PreviewText} from './preview.ts'

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
