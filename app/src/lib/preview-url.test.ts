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

// task-37691740e53e77b7: the Preview view is opt-in (desk.previewView) and never loads from nowhere.
test('the Preview view: opt-in, and only with an origin to load from', async () => {
  const {previewOrigin, previewViewTemplate} = await import('./preview-url.ts')
  const abs = 'http://localhost:3537/posts/:slug'
  assert.equal(previewViewTemplate({preview: abs}), undefined, 'desk.preview alone adds no tab (the reference post stays Sanity\'s)')
  assert.equal(previewViewTemplate({preview: abs, previewView: {}}), abs)
  assert.equal(previewViewTemplate({preview: '/posts/:slug', previewView: {}}), undefined, 'no origin: no tab')
  assert.equal(previewViewTemplate({preview: '/posts/:slug', previewView: {}}, 'https://site.example/'), '/posts/:slug')
  assert.equal(previewViewTemplate({previewView: {}}), undefined)
  assert.equal(previewOrigin(abs), 'http://localhost:3537')
})
