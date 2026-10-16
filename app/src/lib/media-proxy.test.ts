import {test} from 'node:test'
import assert from 'node:assert/strict'
import {fallsBackToOriginal, mediaHeaders, transformQuery} from './media-proxy.ts'

test('only the transform parameters go on, in one order', () => {
  assert.equal(transformQuery(new URLSearchParams('auto=format&fit=max&h=540&w=1200&token=x&size=thumb')), 'w=1200&h=540&fit=max&auto=format')
  assert.equal(transformQuery(new URLSearchParams('')), '')
})

test('a reader refused is not retried as the original, and the refusal is not cached', () => {
  for (const s of [401, 403, 404]) assert.equal(fallsBackToOriginal(s), false)
  assert.equal(fallsBackToOriginal(400), true)
  assert.equal(fallsBackToOriginal(429), true)
  assert.equal(mediaHeaders(false, 'application/json')['cache-control'], 'no-store')
  assert.match(mediaHeaders(true, 'image/avif')['cache-control'], /immutable/)
})
