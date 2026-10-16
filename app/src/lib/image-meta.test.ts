import {test} from 'node:test'
import assert from 'node:assert/strict'
import {imageMeta, sizeLabel, uploadMeta} from './image-meta.ts'

test('size and placeholder: Sanity metadata first, then fileInfo', () => {
  assert.deepEqual(imageMeta({asset: {fileInfo: {width: '640', height: '400', lqip: 'data:a'}}}), {width: 640, height: 400, lqip: 'data:a'})
  const both = imageMeta({asset: {fileInfo: {width: '1', height: '1', lqip: 'data:a'}, metadata: {dimensions: {width: 640, height: 400}, lqip: 'data:b', palette: {dominant: {background: '#3c8c44'}}}}})
  assert.deepEqual(both, {width: 640, height: 400, lqip: 'data:b', dominant: '#3c8c44'})
  assert.deepEqual(imageMeta({asset: {fileInfo: {width: '', height: ''}}}), {})
  assert.equal(sizeLabel(both), '640 × 400')
  assert.equal(sizeLabel({width: 640}), undefined)
})

test("an image field's options.metadata, as the upload's meta", () => {
  assert.deepEqual(uploadMeta({metadata: ['exif', 'location', 'palette']}), ['exif', 'location'])
  assert.deepEqual(uploadMeta({accept: 'image/*'}), [])
  assert.deepEqual(uploadMeta(undefined), [])
})
