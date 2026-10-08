// J56: prepared previews, read the way Sanity's prepare in reference/sanity/schemaTypes/category.ts reads.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {formatPreview, previewRefs, type PreviewText} from './preview.ts'

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
