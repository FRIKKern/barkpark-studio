import {test} from 'node:test'
import assert from 'node:assert/strict'
import {FILE_CSP, fallsBackToOriginal, fileSafetyHeaders, mediaHeaders, transformQuery} from './media-proxy.ts'

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

// task-71cb73cb5f89acef: an uploaded SVG opened on the studio's origin ran its script there.
test('every uploaded file is nosniff; an SVG is sandboxed, and a download when opened as a page', () => {
  for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif', 'video/mp4', 'audio/mpeg', 'application/pdf']) {
    const h = fileSafetyHeaders(type, 'document')
    assert.equal(h['x-content-type-options'], 'nosniff', type)
    assert.equal(h['content-security-policy'], undefined, type)
    assert.equal(h['content-disposition'], undefined, type)
  }
  // An <img> (or a fetch) still gets the SVG inline, under the sandbox CSP.
  for (const dest of ['image', 'empty', null]) {
    const h = fileSafetyHeaders('image/svg+xml', dest)
    assert.equal(h['content-security-policy'], FILE_CSP)
    assert.match(h['content-security-policy'], /sandbox/)
    assert.match(h['content-security-policy'], /default-src 'none'/)
    assert.equal(h['content-disposition'], undefined)
  }
  // Opened as a page: sandboxed and downloaded.
  assert.equal(fileSafetyHeaders('image/svg+xml', 'document')['content-disposition'], 'attachment')
  // Anything else that is not passive: sandboxed and downloaded, wherever it is asked for.
  for (const type of ['text/html; charset=utf-8', 'application/octet-stream', 'application/xml', 'text/javascript', 'application/json']) {
    const h = fileSafetyHeaders(type, 'image')
    assert.equal(h['x-content-type-options'], 'nosniff', type)
    assert.equal(h['content-security-policy'], FILE_CSP, type)
    assert.equal(h['content-disposition'], 'attachment', type)
  }
  // mediaHeaders carries them on a file, and only nosniff on a refusal.
  assert.equal(mediaHeaders(true, 'image/svg+xml', 'image')['content-security-policy'], FILE_CSP)
  assert.match(mediaHeaders(true, 'image/svg+xml', 'image').vary, /Sec-Fetch-Dest/)
  assert.deepEqual(mediaHeaders(false, 'application/json')['x-content-type-options'], 'nosniff')
  assert.equal(mediaHeaders(false, 'application/json')['content-disposition'], undefined)
})
