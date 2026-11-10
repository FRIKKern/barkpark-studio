#!/usr/bin/env node
// The Phoenix desk (Barkpark's own LiveView desk, .../d/<dataset>/studio/_desk/<panes>) served
// at /structure/<panes> on localhost, so the specs run against it as they are: the same URLs,
// the same href selectors, the same URL checks (project `desk`, `pnpm desk`).
//
// It is a plain reverse proxy to BARKPARK_URL with one alias, both ways:
//   /structure…  ⇄  /w/<workspace>/p/<project>/d/<dataset>/studio/_desk…
// in request paths, Location headers, HTML bodies and LiveView's WebSocket frames (the join
// and every patch carry the page's URL; every diff carries hrefs). Everything else passes as
// it is. An e2e-* dataset only.
//
// It is also the slow network for J51: Chrome's throttling (CDP) does not delay frames on a
// WebSocket that is already open, and a LiveView click is such a frame. Here every HTTP
// request waits `latency` ms once and every WebSocket frame half of it each way (a click and
// its answer: one `latency`), and bytes to the browser are paced at `down` bytes/s.
//   GET /__rig/shape?latency=562.5&down=162000   set (0 = off)      GET /__rig/health   read
import http from 'node:http'
import https from 'node:https'
import {createHash} from 'node:crypto'

const need = (k) => process.env[k] ?? fail(`missing ${k}`)
function fail(msg) {
  console.error(`desk-proxy: ${msg}`)
  process.exit(1)
}
const UP = new URL(need('BARKPARK_URL'))
const DATASET = need('BARKPARK_DATASET')
if (!/^e2e-[a-z0-9][a-z0-9-]*$/.test(DATASET)) fail(`an e2e-* dataset only, not "${DATASET}"`)
const PORT = Number(process.env.DESK_PORT || 3200)
const LOCAL = `http://localhost:${PORT}`
const BASE = `/w/${need('BARKPARK_WORKSPACE')}/p/${process.env.BARKPARK_PROJECT || 'default'}/d/${DATASET}/studio/_desk`
const ALIAS = '/structure'
const web = UP.protocol === 'https:' ? https : http
const agent = new web.Agent({keepAlive: true})

const shape = {latency: Number(process.env.DESK_LATENCY_MS || 0), down: Number(process.env.DESK_DOWN_BPS || 0)}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** A request path as the browser has it → the desk's own. */
const pathUp = (path) => (path === ALIAS || (path.startsWith(ALIAS) && '/;?#'.includes(path[ALIAS.length])) ? BASE + path.slice(ALIAS.length) : path)
/** Text from the browser (a header, a WebSocket frame): its URLs and quoted paths → the desk's own. */
const textUp = (s) =>
  s
    .replaceAll(LOCAL + ALIAS, UP.origin + BASE)
    .replaceAll(LOCAL, UP.origin)
    .replace(/(["'])\/structure(?=["'/;?#])/g, (_, q) => q + BASE)
/** Text from the desk → as the browser is to see it. */
const textDown = (s) => s.replaceAll(BASE, ALIAS).replaceAll(UP.origin, LOCAL)

/** Bytes to the browser, at `down` bytes/s when set (20 slices a second). */
async function paced(write, buf) {
  if (!shape.down) return void write(buf)
  const slice = Math.max(1, Math.ceil(shape.down / 20))
  for (let i = 0; i < buf.length; i += slice) {
    write(buf.subarray(i, i + slice))
    if (i + slice < buf.length) await sleep(50)
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, LOCAL)
  if (url.pathname === '/__rig/health' || url.pathname === '/__rig/shape') {
    if (url.pathname === '/__rig/shape') for (const k of ['latency', 'down']) if (url.searchParams.has(k)) shape[k] = Number(url.searchParams.get(k)) || 0
    res.writeHead(200, {'content-type': 'application/json'})
    return void res.end(JSON.stringify({ok: true, alias: ALIAS, dataset: DATASET, ...shape}))
  }
  const headers = {...req.headers, host: UP.host, 'accept-encoding': 'identity'}
  for (const k of ['origin', 'referer']) if (headers[k]) headers[k] = textUp(headers[k])
  const up = web.request({hostname: UP.hostname, port: UP.port || undefined, method: req.method, path: pathUp(req.url), headers, agent}, async (r) => {
    const h = {...r.headers}
    delete h['strict-transport-security']
    if (h.location) h.location = textDown(h.location)
    // The session cookie is the upstream host's, and Secure: here it is localhost's, over http.
    if (h['set-cookie']) h['set-cookie'] = h['set-cookie'].map((c) => c.replace(/;\s*(?:domain=[^;]*|secure)/gi, ''))
    if (h['content-security-policy']) h['content-security-policy'] = h['content-security-policy'].replaceAll(UP.host, `localhost:${PORT}`).replace(/upgrade-insecure-requests;?/g, '')
    try {
      if (/text\/html/.test(h['content-type'] ?? '')) {
        const chunks = []
        for await (const c of r) chunks.push(c)
        const body = Buffer.from(textDown(Buffer.concat(chunks).toString('utf8')))
        h['content-length'] = String(body.length)
        delete h['transfer-encoding']
        res.writeHead(r.statusCode, h)
        await paced((b) => res.write(b), body)
      } else {
        res.writeHead(r.statusCode, h)
        for await (const c of r) await paced((b) => res.write(b), c)
      }
    } catch {
      // the browser or the desk went away mid-answer
    }
    res.end()
  })
  up.on('error', (e) => (res.headersSent || res.writeHead(502, {'content-type': 'text/plain'}), res.end(`desk-proxy: ${e.message}`)))
  if (shape.latency) await sleep(shape.latency)
  req.pipe(up)
})

// ── WebSocket: the browser's side is spoken here (RFC 6455, no extensions), the desk's by
// Node's own client. Whole messages only, so a text frame can be rewritten.
const frame = (opcode, payload) => {
  const n = payload.length
  const head = Buffer.alloc(n < 126 ? 2 : n < 65536 ? 4 : 10)
  head[0] = 0x80 | opcode
  if (n < 126) head[1] = n
  else if (n < 65536) (head[1] = 126), head.writeUInt16BE(n, 2)
  else (head[1] = 127), head.writeBigUInt64BE(BigInt(n), 2)
  return Buffer.concat([head, payload])
}

server.on('upgrade', (req, socket) => {
  const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
  socket.setNoDelay(true)
  // The socket's query can carry the page's URL too (LiveView's referer).
  const query = req.url.replaceAll(encodeURIComponent(LOCAL + ALIAS), encodeURIComponent(UP.origin + BASE)).replaceAll(encodeURIComponent(LOCAL), encodeURIComponent(UP.origin))
  const up = new WebSocket(`${UP.protocol === 'https:' ? 'wss' : 'ws'}://${UP.host}${query}`, {
    headers: {cookie: req.headers.cookie ?? '', origin: UP.origin, 'user-agent': req.headers['user-agent'] ?? 'desk-proxy'},
  })
  up.binaryType = 'arraybuffer'
  const opened = new Promise((resolve) => up.addEventListener('open', resolve, {once: true}))
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    socket.destroy()
    try {
      up.close()
    } catch {
      // not open yet
    }
  }
  // One line per direction: every message leaves half a `latency` after it came, in order.
  const line = () => {
    let last = Promise.resolve()
    return (send) => {
      const due = Date.now() + shape.latency / 2
      last = last.then(async () => {
        const wait = due - Date.now()
        if (wait > 0) await sleep(wait)
        if (!closed) await send()
      }).catch(close)
    }
  }
  const toDesk = line()
  const toBrowser = line()
  up.addEventListener('message', (e) => {
    const text = typeof e.data === 'string'
    const payload = text ? Buffer.from(textDown(e.data)) : Buffer.from(e.data)
    toBrowser(() => paced((b) => socket.write(b), frame(text ? 1 : 2, payload)))
  })
  up.addEventListener('close', close)
  up.addEventListener('error', close)
  socket.on('close', close)
  socket.on('error', close)

  let buf = Buffer.alloc(0)
  let parts = []
  let kind = 0
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk])
    for (;;) {
      if (buf.length < 2) return
      let n = buf[1] & 127
      let at = 2
      if (n === 126) {
        if (buf.length < 4) return
        n = buf.readUInt16BE(2)
        at = 4
      } else if (n === 127) {
        if (buf.length < 10) return
        n = Number(buf.readBigUInt64BE(2))
        at = 10
      }
      const masked = !!(buf[1] & 128)
      if (buf.length < at + (masked ? 4 : 0) + n) return
      const key = masked ? buf.subarray(at, at + 4) : null
      at += masked ? 4 : 0
      const payload = Buffer.from(buf.subarray(at, at + n))
      if (key) for (let i = 0; i < n; i++) payload[i] ^= key[i & 3]
      const fin = !!(buf[0] & 128)
      const opcode = buf[0] & 15
      buf = buf.subarray(at + n)
      if (opcode === 8) return close()
      if (opcode === 9) socket.write(frame(10, payload))
      if (opcode > 2) continue
      if (opcode) kind = opcode
      parts.push(payload)
      if (!fin) continue
      const whole = Buffer.concat(parts)
      const message = kind === 1 ? textUp(whole.toString('utf8')) : whole
      parts = []
      toDesk(async () => (await opened, up.send(message)))
    }
  })
})

server.listen(PORT, '127.0.0.1', () => console.log(`desk-proxy: ${LOCAL}${ALIAS} is the Phoenix desk of dataset ${DATASET}`))
