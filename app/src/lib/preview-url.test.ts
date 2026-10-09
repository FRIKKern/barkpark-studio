import {test} from 'node:test'
import assert from 'node:assert/strict'
import {previewUrlOf, slugOf} from './preview-url.ts'
import type {Doc} from './data.ts'

const tpl = 'http://localhost:3102/api/preview?type=author&slug=:slug'

test('fills :slug and :id, and swaps the origin when overridden', () => {
  assert.equal(previewUrlOf(tpl, 'a1', 'ola nordmann', ''), 'http://localhost:3102/api/preview?type=author&slug=ola%20nordmann')
  assert.equal(previewUrlOf(tpl, 'a1', 'ola', 'http://localhost:3003/'), 'http://localhost:3003/api/preview?type=author&slug=ola')
  assert.equal(previewUrlOf('https://x.test/p/:id', 'a/1', undefined, ''), 'https://x.test/p/a%2F1')
})

test('no slug, no URL: the view asks for one', () => {
  assert.equal(previewUrlOf(tpl, 'a1', undefined, ''), null)
  assert.equal(slugOf({slug: {current: 'x'}} as unknown as Doc), 'x')
  assert.equal(slugOf({slug: 'y'} as unknown as Doc), 'y')
  assert.equal(slugOf({slug: ''} as unknown as Doc), undefined)
})
