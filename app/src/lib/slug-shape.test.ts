import {test} from 'node:test'
import assert from 'node:assert/strict'
import {slugQueries, takenByOther} from './slug-shape.ts'

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
