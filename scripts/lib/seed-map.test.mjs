import {test} from 'node:test'
import assert from 'node:assert/strict'
import {toBarkpark} from './seed-map.mjs'

// An image in an array (a gallery) takes the shape the studio writes for one, as a field's
// image does: its asset resolved, its hotspot and alt kept. It stayed `kind: 'image'` with
// the raw _sanityAsset, drawn as an untitled item with no picture (task-a81703dbd610ce65).
test('seed images map to the asset ref, in a field and in an array', () => {
  const img = (k) => ({...(k ? {_key: k} : {}), _type: 'image', _sanityAsset: 'image@file://./assets/fixture-image.png', hotspot: {x: 0.7, y: 0.35, width: 0.2, height: 0.2}, alt: 'Sun'})
  const out = toBarkpark({_id: 'x', _type: 'post', mainImage: img(), gallery: [img('g1'), img('g2')]}, () => 'asset-123')
  const ref = {_type: 'reference', _ref: 'asset-123'}
  assert.deepEqual(out.mainImage, {_type: 'image', hotspot: {x: 0.7, y: 0.35, width: 0.2, height: 0.2}, alt: 'Sun', asset: ref})
  assert.deepEqual(out.gallery, ['g1', 'g2'].map((k) => ({_key: k, _type: 'image', hotspot: {x: 0.7, y: 0.35, width: 0.2, height: 0.2}, alt: 'Sun', asset: ref})))
  // A multi-type object array is still a composite with `kind` (decision 0005).
  assert.deepEqual(toBarkpark({_id: 'y', _type: 'post', links: [{_key: 'l1', _type: 'externalLink', title: 'T', url: 'u'}]}).links, [{_key: 'l1', kind: 'externalLink', title: 'T', url: 'u'}])
})
