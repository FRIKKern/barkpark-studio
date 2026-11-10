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

const SCRIPT = process.env.DESK_PROXY ?? fileURLToPath(new URL('./desk-proxy.mjs', import.meta.url))
const DATASET = 'e2e-rig-test'
const BASE = `/w/ws/p/default/d/${DATASET}/studio/_desk`

/** What the fake desk was asked: request paths, upgrade paths, and the first byte of each frame. */
const seen = {requests: [], upgrades: [], frames: []}
const desk = http.createServer((req, res) => {
  seen.requests.push(req.url)
  res.writeHead(200, {'content-type': 'text/plain'})
  res.end('desk')
})
desk.on('upgrade', (req, socket) => {
  seen.upgrades.push(req.url)
  const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
  socket.on('data', (chunk) => seen.frames.push(chunk[0]))
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
  const env = {...process.env, BARKPARK_URL: `http://127.0.0.1:${desk.address().port}`, BARKPARK_DATASET: DATASET, BARKPARK_WORKSPACE: 'ws', BARKPARK_PROJECT: 'default', DESK_PORT: String(port), DESK_LATENCY_MS: '0', DESK_DOWN_BPS: '0'}
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
/** A WebSocket upgrade by hand: the status line the proxy answers with. */
const upgrade = (path) => new Promise((resolve, reject) => {
  const req = http.request({host: '127.0.0.1', port, path, headers: {connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ=='}})
  req.on('upgrade', (res, socket) => (socket.destroy(), resolve(res.statusCode)))
  req.on('response', (res) => (res.resume(), resolve(res.statusCode)))
  req.on('error', reject)
  req.end()
})
const settle = () => new Promise((r) => setTimeout(r, 200))

test('a path naming a dataset that is not e2e-* is answered 403 and never reaches the desk', async () => {
  for (const path of [
    '/w/ws/p/default/d/production/studio/_desk/post',
    '/w/ws/p/default/d/%70roduction/studio',
    '/v1/data/doc/production/post/abc',
    '/w/ws/p/default/v1/data/query/production/post',
    '/v1/media/production/abc',
    '/v1/schemas/production',
    '/structure?dataset=production',
  ]) assert.equal(await get(path), 403, path)
  assert.deepEqual(seen.requests, [])
})

test('a WebSocket upgrade naming a dataset that is not e2e-* is answered 403 and never reaches the desk', async () => {
  assert.equal(await upgrade('/w/ws/p/default/d/production/live/websocket?vsn=2.0.0'), 403)
  await settle()
  assert.deepEqual(seen.upgrades, [])
})

test('a LiveView navigation to another dataset over the open socket is not passed on', async () => {
  const ws = new WebSocket(`ws://localhost:${port}/live/websocket?vsn=2.0.0`)
  await new Promise((resolve) => ws.addEventListener('open', resolve, {once: true}))
  const closed = new Promise((resolve) => ws.addEventListener('close', resolve, {once: true}))
  ws.send(JSON.stringify(['4', '4', 'lv:phx-1', 'phx_join', {url: `http://localhost:${port}/w/ws/p/default/d/production/studio/_desk`, params: {}}]))
  await Promise.race([closed, settle().then(settle)])
  assert.ok(!seen.frames.includes(0x81), 'the desk got the join to production')
  ws.close()
})

test("the desk's own traffic passes: /structure, assets, sign-in, its socket, the e2e dataset's API", async () => {
  for (const path of ['/structure/post', '/assets/app.js', '/login', `/v1/data/search/${DATASET}?q=a`, `/v1/media/${DATASET}/abc`]) assert.equal(await get(path), 200, path)
  assert.deepEqual(seen.requests, [`${BASE}/post`, '/assets/app.js', '/login', `/v1/data/search/${DATASET}?q=a`, `/v1/media/${DATASET}/abc`])
  const ws = new WebSocket(`ws://localhost:${port}/live/websocket?vsn=2.0.0`)
  await new Promise((resolve) => ws.addEventListener('open', resolve, {once: true}))
  ws.send(JSON.stringify(['4', '4', 'lv:phx-1', 'phx_join', {url: `http://localhost:${port}/structure/post`, params: {}}]))
  for (let i = 0; i < 20 && !seen.frames.includes(0x81); i++) await new Promise((r) => setTimeout(r, 25))
  ws.close()
  assert.deepEqual(seen.upgrades, ['/live/websocket?vsn=2.0.0'])
  assert.ok(seen.frames.includes(0x81), 'the join to the e2e desk reached it')
})
