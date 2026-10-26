import {test} from 'node:test'
import assert from 'node:assert/strict'
import {FILE_CSP, fallsBackToOriginal, fileSafetyHeaders, mediaHeaders, pathCache, readAsset, transformQuery} from './media-proxy.ts'

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

test("the library list fills the proxy's paths, so a tile it draws skips its metadata read", () => {
  // Local Barkpark, 330 fresh images, Media opened on Images: the first 12 thumbnails drew
  // 2.2-3.3 s after the list with a metadata read per tile, 1.4-1.7 s with the paths known
  // (task-bb3bf037b79c6bce).
  const paths = pathCache(3)
  paths.fill('bp|ds', [{id: 'a', url: '/files/a.png', mimeType: 'image/png'}, {id: 'b'}])
  assert.deepEqual(paths.get('bp|ds|a'), {url: '/files/a.png', mimeType: 'image/png'})
  assert.equal(paths.get('bp|ds|b'), undefined, 'a hit without a url is left to the metadata read')
  assert.equal(paths.get('bp|other|a'), undefined, 'per Barkpark and dataset')
  paths.fill('bp|ds', [{id: 'c', url: '/c'}, {id: 'd', url: '/d'}, {id: 'e', url: '/e'}])
  assert.ok(paths.size() <= 3, 'bounded')
})

test("a path another reader's list warmed never lets a reader skip their own access check", async () => {
  const paths = pathCache()
  // Reader A's list read the asset: A's own key holds its path.
  paths.fill('bp|ds|reader-a', [{id: 'x', url: '/files/x.png', mimeType: 'image/png'}])
  // Barkpark as each token sees it: A has a seat, B has none.
  const calls: string[] = []
  const io = (token: string) => ({
    meta: async () => (calls.push(`meta ${token}`), new Response(token === 'A' ? JSON.stringify({result: {url: '/files/x.png', mimeType: 'image/png'}}) : null, {status: token === 'A' ? 200 : 403})),
    file: async (path: string) => (calls.push(`file ${token} ${path}`), new Response(token === 'A' ? 'bytes' : null, {status: token === 'A' ? 200 : 403})),
  })
  const b = await readAsset('x', 'bp|ds|reader-b', paths, 'w=320', io('B'))
  assert.equal(b.status, 403, 'B is refused')
  assert.deepEqual(calls, ['meta B'], "B's own metadata read, with B's token; no file read")
  calls.length = 0
  const a = await readAsset('x', 'bp|ds|reader-a', paths, 'w=320', io('A'))
  assert.equal(a.status, 200)
  assert.deepEqual(calls, ['file A /files/x.png?w=320'], "A's warm path skips the metadata read; the file read still goes with A's token")
  // A path B once had is still read with B's token: a seat taken away since is refused.
  paths.fill('bp|ds|reader-b', [{id: 'x', url: '/files/x.png', mimeType: 'image/png'}])
  calls.length = 0
  const b2 = await readAsset('x', 'bp|ds|reader-b', paths, '', io('B'))
  assert.equal(b2.status, 403)
  assert.deepEqual(calls, ['file B /files/x.png'])
})
