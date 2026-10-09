// Hotspot and crop maths (J12), against what Sanity's tool stored for the same
// moves (measured 2026-10-06 on reference/sanity, e2e/journeys/image.spec.ts).
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {dragCrop, frame, imageRef, moveCrop, moveHotspot, NO_CROP, NO_HOTSPOT, resizeHotspot} from './image.ts'

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≉ ${b}`)

test('a full-size hotspot cannot move; a resized one moves and stays on the image', () => {
  assert.deepEqual(moveHotspot(NO_HOTSPOT, -0.1, 0), NO_HOTSPOT)
  const h = resizeHotspot(NO_HOTSPOT, -0.3217, -0.3145) // Sanity: 0.3566, 0.3710
  near(h.width, 0.3566)
  near(h.height, 0.371)
  near(moveHotspot(h, -0.025, 0).x, 0.475)
  near(moveHotspot(h, -1, 0).x, h.width / 2)
})

test('crop: a side follows the pointer, the window keeps a minimum, moving keeps its size', () => {
  const c = dragCrop(NO_CROP, 'right', 0.8213, 0.5) // Sanity: right 0.1787
  near(c.right, 0.1787)
  assert.equal(dragCrop(c, 'left', 0.99, 0.5).left, 1 - c.right - 0.05)
  const moved = moveCrop(c, 0.02, 0)
  near(moved.left, 0.02)
  near(moved.right, 0.1587)
  near(moveCrop(c, 1, 0).left, c.right) // stops at the right edge
})

test('a preview frame keeps the hotspot centred inside the crop', () => {
  const f = frame(NO_CROP, {x: 0.9, y: 0.5, width: 0.1, height: 0.1}, {width: 640, height: 400}, 1)
  near(f.width, 400 / 640)
  near(f.height, 1)
  near(f.left + f.width, 1) // pushed against the right edge, not past it
})

test('an image ref reads the canonical value and the legacy {assetId} one', () => {
  assert.equal(imageRef({asset: {_ref: 'asset-a1'}}), 'asset-a1')
  assert.equal(imageRef({assetId: 'b2', url: '/media/files/b2.jpg', alt: 'x'}), 'asset-b2')
  assert.equal(imageRef({alt: 'only alt'}), undefined)
  assert.equal(imageRef(null), undefined)
})
