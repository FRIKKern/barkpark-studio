// J56: prepared previews, read the way Sanity's prepare in reference/sanity/schemaTypes/category.ts reads.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {formatPreview, previewMedia, previewRefs, type PreviewText} from './preview.ts'

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
  assert.equal(previewMedia(['backgroundImage', 'images', 'linkedDocument.cover'], read({images: [{productId: 'p'}, img]}), isImage), img)
  assert.equal(previewMedia(['backgroundImage', 'linkedDocument.cover'], read({'linkedDocument.cover': img}), isImage), img)
  assert.equal(previewMedia('backgroundImage', read({}), isImage), undefined)
})
