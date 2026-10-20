import {test} from 'node:test'
import assert from 'node:assert/strict'
import {bulkSlugAsks, slugInQueries, slugQueries, takenAmong, takenByOther} from './slug-shape.ts'

// A slug is the same slug in either stored shape: Barkpark's plain string and Sanity's
// {_type: 'slug', current} (imported content). Both are asked for; another document holding
// it in either shape, as draft or published, makes it taken.
test('slug in use: asked in both shapes, taken by any other document', () => {
  assert.deepEqual(slugQueries('slug', 'my post'), [
    'perspective=raw&limit=5&filter[slug][eq]=my%20post',
    'perspective=raw&limit=5&filter[slug.current][eq]=my%20post',
  ])
  assert.equal(takenByOther([{_id: 'drafts.a', _publishedId: 'a'}], 'a'), false) // its own draft
  assert.equal(takenByOther([{_id: 'a'}, {_id: 'drafts.b'}], 'a'), true) // another doc's draft
  assert.equal(takenByOther([], 'a'), false)
})

// A bulk publish asks once per type and slug field for every picked doc, 50 slugs a query
// (both shapes), not once per doc: 300 posts are 12 reads one after another, not 300 at once.
test('bulk publish: one ask per type and field, chunked, and who holds each slug', () => {
  const posts = Array.from({length: 300}, (_, i) => ({_id: `drafts.p${i}`, _publishedId: `p${i}`, _type: 'post', slug: i % 2 ? `s${i}` : {_type: 'slug', current: `s${i}`}}))
  const asks = bulkSlugAsks([...posts, {_id: 'drafts.a1', _publishedId: 'a1', _type: 'author', title: 'no slug'}], (type) => (type === 'post' ? ['slug'] : []))
  assert.equal(asks.length, 1)
  assert.equal(asks[0]!.picked.length, 300)
  assert.deepEqual(asks[0]!.picked[0], {id: 'p0', value: 's0'})
  assert.equal(slugInQueries('slug', asks[0]!.picked.map((p) => p.value)).length, 12)
  assert.deepEqual(slugInQueries('slug', ['a,b', 'c', 'c']), [
    'perspective=raw&limit=1000&filter[slug][in][]=a%2Cb&filter[slug][in][]=c',
    'perspective=raw&limit=1000&filter[slug.current][in][]=a%2Cb&filter[slug.current][in][]=c',
  ])
  const picked = [{id: 'x', value: 'mine'}, {id: 'y', value: 'theirs'}, {id: 'z', value: 'twin'}, {id: 'w', value: 'twin'}]
  const found = [{_id: 'drafts.x', slug: 'mine'}, {_id: 'other', slug: {_type: 'slug', current: 'theirs'}}, {_id: 'drafts.y', slug: 'theirs'}]
  // x: only its own draft; y: another doc has it (Sanity's shape); z and w: picked together with one slug.
  assert.deepEqual([...takenAmong(found, 'slug', picked)].sort(), ['w', 'y', 'z'])
})
