// Sanity's intent links, read.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {parseIntent} from './intent.ts'

test('parseIntent: edit with and without type, create with a template and its parameters, junk', () => {
  assert.deepEqual(parseIntent('edit/id=post-03;type=post'), {action: 'edit', id: 'post-03', type: 'post'})
  // A stega edit link from a site's click-to-edit (Sanity's createEditUrl): the field rides along.
  assert.deepEqual(parseIntent('edit/mode=presentation;id=post-03;type=post;path=links%5B_key%3D%3D%22l1%22%5D.title'), {action: 'edit', id: 'post-03', type: 'post', path: 'links[_key=="l1"].title'})
  assert.deepEqual(parseIntent('edit/id=post-03'), {action: 'edit', id: 'post-03'})
  assert.deepEqual(parseIntent('create/template=post-by-author;type=post/eyJhdXRob3JJZCI6ImF1dGhvci1hbGFuIn0'), {action: 'create', type: 'post', template: 'post-by-author', params: {authorId: 'author-alan'}})
  assert.deepEqual(parseIntent('create/type=post'), {action: 'create', type: 'post', params: {}})
  assert.equal(parseIntent('publish/id=x'), null)
  assert.equal(parseIntent('edit/type=post'), null)
})
