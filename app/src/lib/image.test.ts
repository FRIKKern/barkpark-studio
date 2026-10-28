// Hotspot and crop maths (J12), against what Sanity's tool stored for the same
// moves (measured 2026-10-06 on reference/sanity, e2e/journeys/image.spec.ts).
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {assetUrl, cropView, dragCrop, fitHotspot, frame, imageFileName, imageRef, pickedImage, sanityImageId, sanityImagePath, moveCrop, moveHotspot, NO_CROP, NO_HOTSPOT, resizeHotspot} from './image.ts'

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

// Sanity's tool keeps the hotspot inside the crop. The same moves on both (2026-10-20, the
// hotspot/crop sweep): crop's right edge in 20%, the hotspot's corner in 30%; Sanity stored
// {x 0.4, y 0.5, width 0.2, height 0.4}.
test('the hotspot stays inside the crop: a crop pulled across it narrows and moves it', () => {
  const c = dragCrop(NO_CROP, 'right', 0.8, 0.5)
  const fitted = fitHotspot(NO_HOTSPOT, c)
  near(fitted.x, 0.4)
  near(fitted.width, 0.8)
  const h = fitHotspot(resizeHotspot(fitted, -0.3, -0.3), c)
  assert.deepEqual(h, {x: 0.4, y: 0.5, width: 0.2, height: 0.4})
  assert.equal(fitHotspot(h, c), h) // already inside: the same object
  near(fitHotspot(moveHotspot(h, 0.5, 0), c).x, 0.7) // moved past the crop's edge: back in
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

test('a picked asset keeps the legacy shape only where the content uses it', () => {
  const legacy = {assetId: 'old', url: '/media/files/old.jpg', alt: 'A', focalX: 0.3, hotspot: {x: 0.5, y: 0.5, width: 1, height: 1}}
  assert.deepEqual(pickedImage(legacy, 'asset-new', '/media/files/new.jpg'), {alt: 'A', asset: {_ref: 'asset-new'}, assetId: 'new', url: '/media/files/new.jpg'})
  assert.deepEqual(pickedImage(legacy, 'asset-new'), {alt: 'A', asset: {_ref: 'asset-new'}})
  // Canonical content (and the older bare {asset: {_ref}}) gets Sanity's shape on a new pick.
  assert.deepEqual(pickedImage({asset: {_ref: 'asset-a'}, alt: 'B'}, 'asset-b', '/x.jpg'), {alt: 'B', _type: 'image', asset: {_type: 'reference', _ref: 'asset-b'}})
  assert.deepEqual(pickedImage({}, 'asset-c'), {_type: 'image', asset: {_type: 'reference', _ref: 'asset-c'}})
  // Both shapes read the same.
  assert.equal(imageRef({asset: {_ref: 'asset-a'}}), imageRef({_type: 'image', asset: {_type: 'reference', _ref: 'asset-a'}}))
})

test("a body image card names the file as Barkpark's canvas does", () => {
  assert.equal(imageFileName('/w/a/p/default/media/files/d/ds/2026/10/fixture-image-cbf5348f.png', 'x', 'Image'), 'fixture-image.png')
  assert.equal(imageFileName('https://example.com/pics/My%20photo-cbf5348f.jpg?w=200', undefined, 'Image'), 'My photo-cbf5348f.jpg')
  assert.equal(imageFileName(undefined, 'paste-image', 'Image'), 'paste-image')
})

test('a Sanity image id: parsed, mapped to Barkpark\'s Sanity image route, served through the media proxy', () => {
  const sha1 = 'AB12'.repeat(10)
  const id = sanityImageId(`image-${sha1}-640x400-PNG`)
  assert.deepEqual(id, {sha1: sha1.toLowerCase(), width: 640, height: 400, ext: 'png'})
  assert.equal(sanityImagePath(id!, 'production'), `/images/barkpark/production/${sha1.toLowerCase()}-640x400.png`)
  assert.equal(assetUrl(`image-${sha1}-640x400-png`), `/api/media/image-${sha1}-640x400-png`)
  for (const ref of ['asset-123', `image-${sha1}-0x400-png`, `image-abc-640x400-png`, `file-${sha1}-pdf`, `image-${sha1}-640x400`, undefined, 42])
    assert.equal(sanityImageId(ref), null, String(ref))
})

test('cropView: the image input shows the crop only, as the rect Sanity asks for (640x400, left half and bottom 30% cut)', () => {
  const v = cropView({top: 0, bottom: 0.3, left: 0.5, right: 0}, {width: 640, height: 400})!
  // Sanity's preview asks for rect=320,0,320,280: a 320 x 280 box.
  assert.equal(v.width, 320)
  assert.equal(v.ratio, 320 / 280)
  assert.deepEqual(v.style, {position: 'absolute', width: '200%', height: '142.8571%', left: '-100%', top: '0%', maxWidth: 'none', maxHeight: 'none'})
  // Nothing cropped (or no crop, or a broken one): the plain preview.
  assert.equal(cropView({top: 0, bottom: 0, left: 0, right: 0}, {width: 640, height: 400}), null)
  assert.equal(cropView(undefined, {width: 640, height: 400}), null)
  assert.equal(cropView({top: 0.6, bottom: 0.6, left: 0, right: 0}, {width: 640, height: 400}), null)
})
