import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseScope, scopedPath} from './scope.ts'

test('a scoped path names its workspace, project and dataset; the rest is the studio path', () => {
  assert.deepEqual(parseScope('/w/studio-parity/p/default/d/e2e-freeform/structure/post;post-01'), {
    scope: {workspace: 'studio-parity', project: 'default', dataset: 'e2e-freeform'},
    rest: '/structure/post;post-01',
  })
  assert.deepEqual(parseScope('/w/a/p/b/d/c'), {scope: {workspace: 'a', project: 'b', dataset: 'c'}, rest: '/'})
  assert.equal(scopedPath({workspace: 'a', project: 'b', dataset: 'c'}, '/media'), '/w/a/p/b/d/c/media')
})

test('no prefix, a media file path, or a malformed one is no scope', () => {
  for (const p of ['/structure/post', '/w/studio-parity/p/default/media/files/d/x/2026/a.png', '/w/A/p/b/d/c/structure', '/w/a/p/b/dd/c/structure'])
    assert.equal(parseScope(p).scope, undefined, p)
})
