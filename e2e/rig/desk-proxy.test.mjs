// desk-proxy (node --test rig/desk-proxy.test.mjs): nothing that names a dataset other than
// e2e-* reaches the desk, and the desk's own traffic still does. The proxy runs against a
// fake desk that records every request. DESK_PROXY=<path> runs another copy (the old one).
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createHash} from 'node:crypto'
import http from 'node:http'
import net from 'node:net'
import {after, before, beforeEach, test} from 'node:test'
import {fileURLToPath} from 'node:url'
import zlib from 'node:zlib'

const SCRIPT = process.env.DESK_PROXY ?? fileURLToPath(new URL('./desk-proxy.mjs', import.meta.url))
const DATASET = 'e2e-rig-test'
const BASE = `/w/ws/p/default/d/${DATASET}/studio/_desk`

/** What the fake desk was asked: request paths, upgrade paths, the text frames it got; accept-encodings, bodies it sent. */
const seen = {requests: [], upgrades: [], texts: [], encodings: [], bodies: []}
const CODE = {gzip: zlib.gzipSync, br: zlib.brotliCompressSync, deflate: zlib.deflateSync, ...(zlib.zstdCompressSync && {zstd: zlib.zstdCompressSync})}
const DECODE = {gzip: zlib.gunzipSync, br: zlib.brotliDecompressSync, deflate: zlib.inflateSync, ...(zlib.zstdDecompressSync && {zstd: zlib.zstdDecompressSync})}
/** A desk page: links to itself, as the desk's are. */
const page = (path) => `<a href="${path}">here</a> <a href="${path};doc">a doc</a>`
const desk = http.createServer((req, res) => {
  seen.requests.push(req.url)
  seen.encodings.push(req.headers['accept-encoding'])
  // Pages and assets in the first coding asked for that the desk speaks, as Phoenix answers.
  if (req.url.includes('/studio/_desk') || req.url.startsWith('/assets/')) {
    const html = !req.url.startsWith('/assets/')
    const coding = (req.headers['accept-encoding'] ?? '').split(',').map((t) => t.split(';')[0].trim()).find((c) => CODE[c])
    const text = Buffer.from(html ? page(req.url) : `export const desk = "${BASE}/post"\n`.repeat(40))
    const body = coding ? CODE[coding](text) : text
    seen.bodies.push(body)
    res.writeHead(200, {'content-type': html ? 'text/html; charset=utf-8' : 'text/javascript', 'content-length': body.length, ...(coding && {'content-encoding': coding})})
    return void res.end(body)
  }
  // Sign-in as Barkpark answers it: the session cookie, and off to the account's default Studio.
  if (req.method === 'POST' && req.url === '/login') {
    res.writeHead(302, {location: `http://127.0.0.1:${desk.address().port}/w/ws/p/default/d/production/studio`, 'set-cookie': '_bp=s1; path=/; HttpOnly; Secure'})
    return void res.end()
  }
  res.writeHead(200, {'content-type': 'text/plain'})
  res.end('desk')
})
desk.on('upgrade', (req, socket) => {
  seen.upgrades.push(req.url)
  const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
  let buf = Buffer.alloc(0)
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk])
    while (buf.length >= 6) {
      let n = buf[1] & 127
      let at = 2
      if (n === 126) (n = buf.readUInt16BE(2)), (at = 4)
      if (buf.length < at + 4 + n) return
      const payload = Buffer.from(buf.subarray(at + 4, at + 4 + n)).map((b, i) => b ^ buf[at + (i & 3)])
      if ((buf[0] & 15) === 1) seen.texts.push(payload.toString())
      buf = buf.subarray(at + 4 + n)
    }
  })
  socket.on('error', () => {})
})

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const {port} = s.address()
    s.close(() => resolve(port))
  })
})
let proxy
let port
before(async () => {
  await new Promise((resolve) => desk.listen(0, '127.0.0.1', resolve))
  port = await freePort()
  // Hermetic: no env of the shell (no token, no .env), the desk is the fake on 127.0.0.1.
  const env = {PATH: process.env.PATH, BARKPARK_URL: `http://127.0.0.1:${desk.address().port}`, BARKPARK_DATASET: DATASET, BARKPARK_WORKSPACE: 'ws', BARKPARK_PROJECT: 'default', DESK_PORT: String(port), DESK_LATENCY_MS: '0', DESK_DOWN_BPS: '0'}
  proxy = spawn(process.execPath, [SCRIPT], {env, stdio: 'ignore'})
  for (let i = 0; i < 100; i++) {
    if (await fetch(`http://localhost:${port}/__rig/health`).then((r) => r.ok, () => false)) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('desk-proxy did not start')
})
after(() => {
  proxy?.kill()
  desk.closeAllConnections()
  desk.close()
})
beforeEach(() => Object.values(seen).forEach((list) => (list.length = 0)))

const get = (path) => fetch(`http://localhost:${port}${path}`).then((r) => r.status)
/** A request line exactly as written (no client normalises it): the status it is answered with. */
const raw = (target) => new Promise((resolve, reject) => {
  const s = net.connect(port, '127.0.0.1', () => s.write(`GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`))
  let d = ''
  s.on('data', (c) => (d += c))
  s.on('end', () => resolve(Number(d.split(' ')[1])))
  s.on('error', reject)
})
/** A WebSocket upgrade by hand: the status line the proxy answers with. */
const upgrade = (path) => new Promise((resolve, reject) => {
  const req = http.request({host: '127.0.0.1', port, path, headers: {connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ=='}})
  req.on('upgrade', (res, socket) => (socket.destroy(), resolve(res.statusCode)))
  req.on('response', (res) => (res.resume(), resolve(res.statusCode)))
  req.on('error', reject)
  req.end()
})
const settle = () => new Promise((r) => setTimeout(r, 200))
/** A GET as a browser's network stack has it, nothing decoded: status, headers, the bytes. */
const bytes = (path, headers = {}) => new Promise((resolve, reject) => {
  http.get({host: '127.0.0.1', port, path, headers}, (r) => {
    const chunks = []
    r.on('data', (c) => chunks.push(c))
    r.on('end', () => resolve({status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks)}))
  }).on('error', reject)
})
/** Send one LiveView message on a fresh socket; what reached the desk. */
async function send(vsn, message) {
  seen.texts.length = 0
  const ws = new WebSocket(`ws://localhost:${port}/live/websocket?vsn=${vsn}`)
  await new Promise((resolve) => ws.addEventListener('open', resolve, {once: true}))
  ws.send(typeof message === 'string' ? message : JSON.stringify(message))
  for (let i = 0; i < 12 && !seen.texts.length; i++) await new Promise((r) => setTimeout(r, 25))
  ws.close()
  return [...seen.texts]
}
const OTHER = `http://localhost:PORT/w/ws/p/default/d/production/studio/_desk`
const OURS = `http://localhost:PORT/structure/post`
const at = (u) => u.replace('PORT', String(port))

test('a path naming a dataset that is not e2e-* is answered 403 and never reaches the desk', async () => {
  for (const path of [
    '/w/ws/p/default/d/production/studio/_desk/post',
    '/w/ws/p/default/d/%70roduction/studio',
    // The keyword segment encoded: only decoding before judging stops it.
    '/w/ws/p/default/%64/production/studio',
    '/v1/data/doc/production/post/abc',
    '/w/ws/p/default/v1/data/query/production/post',
    '/v1/media/production/abc',
    '/v1/schemas/production',
    '/structure?dataset=production',
  ]) assert.equal(await get(path), 403, path)
  assert.deepEqual(seen.requests, [])
})

test('an empty segment, a case or a bracketed key cannot carry another dataset past the guard', async () => {
  for (const target of [
    '/w/ws/p/default//v1/data/query/production/post',
    '/w//ws/p/default/v1/data/query/production/post',
    '//v1/data/doc/production/post/abc',
    '//api/schemas',
    'http://evil.example//v1/data/doc/production/post/abc',
    '/w/ws/p/default/D/production/studio',
    '/structure?dataset[]=production',
  ]) assert.equal(await raw(target), 403, target)
  assert.deepEqual(seen.requests, [])
})

test('what reaches the desk is the path that was judged, its dot segments resolved', async () => {
  assert.equal(await raw('/w/ws/p/default/d/production/studio/_desk/../../../e2e-rig-test/studio/_desk'), 200)
  assert.deepEqual(seen.requests, [`/w/ws/p/default/d/${DATASET}/studio/_desk`])
})

test('a WebSocket upgrade naming a dataset that is not e2e-* is answered 403 and never reaches the desk', async () => {
  assert.equal(await upgrade('/w/ws/p/default/d/production/live/websocket?vsn=2.0.0'), 403)
  assert.equal(await upgrade('//w/ws/p/default/d/production/live/websocket?vsn=2.0.0'), 403)
  await settle()
  assert.deepEqual(seen.upgrades, [])
})

test('a LiveView join or patch to another dataset is not passed on: by url or redirect, V2 or V1 frames', async () => {
  const cases = {
    'V2 join, url': ['2.0.0', ['4', '4', 'lv:phx-1', 'phx_join', {url: at(OTHER), params: {}}]],
    'V2 join, redirect': ['2.0.0', ['4', '4', 'lv:phx-1', 'phx_join', {redirect: at(OTHER), params: {}}]],
    'V2 join, url ours and redirect another': ['2.0.0', ['4', '4', 'lv:phx-1', 'phx_join', {url: at(OURS), redirect: at(OTHER), params: {}}]],
    'V2 live_patch': ['2.0.0', ['4', '5', 'lv:phx-1', 'live_patch', {url: at(OTHER)}]],
    'V1 join': ['1.0.0', {topic: 'lv:phx-1', event: 'phx_join', payload: {url: at(OTHER), params: {}}, ref: '1', join_ref: '1'}],
    'V1 live_patch': ['1.0.0', {topic: 'lv:phx-1', event: 'live_patch', payload: {url: at(OTHER)}, ref: '2'}],
    'a frame that is not JSON': ['2.0.0', `not json ${at(OTHER)}`],
  }
  for (const [name, [vsn, message]] of Object.entries(cases)) assert.deepEqual(await send(vsn, message), [], name)
})

test('a frame URL with a dot segment is refused, not resolved: Phoenix would read it as written', async () => {
  const url = at(`http://localhost:PORT/w/ws/p/default/d/production/studio/_desk/../../../${DATASET}/studio/_desk`)
  assert.deepEqual(await send('2.0.0', ['4', '4', 'lv:phx-1', 'phx_join', {url, params: {}}]), [])
})

test('a frame with a duplicate key reaches the desk as the guard read it', async () => {
  const twice = `["4","4","lv:phx-1","phx_join",{"redirect":"${at(OTHER)}","redirect":"${at(OURS)}","params":{}}]`
  const got = await send('2.0.0', twice)
  assert.equal(got.length, 1)
  assert.ok(!got[0].includes('production'), got[0])
})

test('LiveView long-poll is refused outright: its joins ride in bodies', async () => {
  const join = JSON.stringify(['4', '4', 'lv:phx-1', 'phx_join', {url: at(OTHER), params: {}}])
  const r = await fetch(`http://localhost:${port}/live/longpoll?vsn=2.0.0`, {method: 'POST', body: join})
  assert.equal(r.status, 403)
  assert.deepEqual(seen.requests, [])
})

test("the desk's own traffic passes: /structure, assets, sign-in, its socket, the e2e dataset's API", async () => {
  for (const path of ['/structure/post', '/assets/app.js', '/login', `/v1/data/search/${DATASET}?q=a`, `/v1/media/${DATASET}/abc`]) assert.equal(await get(path), 200, path)
  assert.deepEqual(seen.requests, [`${BASE}/post`, '/assets/app.js', '/login', `/v1/data/search/${DATASET}?q=a`, `/v1/media/${DATASET}/abc`])
  assert.equal((await send('2.0.0', ['4', '4', 'lv:phx-1', 'phx_join', {url: at(OURS), params: {}}])).length, 1, 'the join to the e2e desk reached it')
  assert.deepEqual(seen.upgrades, ['/live/websocket?vsn=2.0.0'])
})

// rig/test.ts signs in by the /login form and waits for any URL off /login: the redirect to the
// account's default Studio (production) is refused, the session cookie has landed, the desk serves.
test('sign-in still signs in when its redirect to the default Studio is refused', async () => {
  const r = await fetch(`http://localhost:${port}/login`, {method: 'POST', redirect: 'manual'})
  assert.equal(r.status, 302)
  const cookie = r.headers.get('set-cookie')
  assert.equal(cookie, '_bp=s1; path=/; HttpOnly')
  assert.equal(r.headers.get('location'), `http://localhost:${port}/w/ws/p/default/d/production/studio`)
  assert.equal((await fetch(r.headers.get('location'))).status, 403)
  assert.equal((await fetch(`http://localhost:${port}/structure`, {headers: {cookie: '_bp=s1'}})).status, 200)
  assert.deepEqual(seen.requests, ['/login', BASE])
})

// The paced leg carries what a browser gets (J51): the desk is asked with the browser's own
// accept-encoding, and what the proxy rewrites goes on in the coding the desk answered in.
test("a page the proxy rewrites reaches the browser in the desk's coding, for the browser's accept-encoding", async () => {
  const cases = [['gzip, deflate, br', 'gzip'], ['br;q=1.0, gzip;q=0.8', 'br'], ['deflate', 'deflate'], ...(CODE.zstd ? [['zstd, gzip', 'zstd']] : [])]
  for (const [accept, coding] of cases) {
    seen.encodings.length = 0
    const r = await bytes('/structure/post', {'accept-encoding': accept})
    assert.equal(seen.encodings[0], accept, 'the desk was asked with the browser\'s accept-encoding')
    assert.equal(r.headers['content-encoding'], coding, accept)
    assert.equal(Number(r.headers['content-length']), r.body.length, accept)
    assert.equal(DECODE[coding](r.body).toString(), page('/structure/post'), accept)
  }
  // A coding the proxy could not undo is not offered: the page could not be rewritten.
  seen.encodings.length = 0
  await bytes('/structure/post', {'accept-encoding': 'compress, x-unknown, gzip;q=0.5'})
  assert.deepEqual(seen.encodings, ['gzip;q=0.5'])
})

test('an answer the proxy does not rewrite passes byte for byte, still compressed', async () => {
  const r = await bytes('/assets/app.js', {'accept-encoding': 'gzip, deflate, br'})
  assert.equal(r.headers['content-encoding'], 'gzip')
  assert.deepEqual(r.body, seen.bodies[0])
  assert.ok(zlib.gunzipSync(r.body).toString().includes(BASE), 'its text as the desk wrote it')
})

// list.spec.ts opens another e2e dataset by its full path (/w/…/d/e2e-no-schema-ever/structure).
test("another e2e-* dataset's desk answers by its full path, its links and socket mapped; one not e2e-* is still refused", async () => {
  const other = '/w/ws/p/default/d/e2e-other'
  const r = await bytes(`${other}/structure/post`)
  assert.equal(r.status, 200)
  assert.equal(r.body.toString(), page(`${other}/structure/post`))
  assert.equal(await get(`${other}/structure`), 200)
  assert.equal(await get('/w/ws/p/default/d/production/structure/post'), 403)
  assert.deepEqual(seen.requests, [`${other}/studio/_desk/post`, `${other}/studio/_desk`])
  const up = `http://127.0.0.1:${desk.address().port}${other}/studio/_desk/post`
  const got = await send('2.0.0', ['4', '4', 'lv:phx-1', 'phx_join', {url: at(`http://localhost:PORT${other}/structure/post`), params: {}}])
  assert.deepEqual(got.map((m) => JSON.parse(m)[4].url), [up], 'the join passed the frame guard, as that desk\'s URL')
  seen.upgrades.length = 0
  assert.equal(await upgrade(`/live/websocket?_live_referer=${encodeURIComponent(at(`http://localhost:PORT${other}/structure/post`))}&vsn=2.0.0`), 101)
  await settle()
  assert.deepEqual(seen.upgrades, [`/live/websocket?_live_referer=${encodeURIComponent(up)}&vsn=2.0.0`])
})
