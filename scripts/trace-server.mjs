// Temporary (task-c1df532bed870536), NODE_OPTIONS=--import=<this> on CI's studio server:
// each request it serves (start, first byte, end, status, path without query) and each
// Barkpark fetch it makes (start, duration, status, path without query). No headers, no bodies.
import http from 'node:http'

const out = (s) => process.stderr.write(`${s}\n`)
const f = globalThis.fetch
globalThis.fetch = async (u, init) => {
  const t = Date.now()
  const url = String(u?.url ?? u).replace(/\?.*/, '').replace(/^https?:\/\/[^/]+/, '')
  const done = (s) => out(`FETCH ${t} ${Date.now() - t} ${s} ${init?.method ?? u?.method ?? 'GET'} ${url}`)
  try {
    const r = await f(u, init)
    done(r.status)
    return r
  } catch (e) {
    done('ERR')
    throw e
  }
}
const emit = http.Server.prototype.emit
http.Server.prototype.emit = function (ev, req, res) {
  if (ev === 'request' && res) {
    const t = Date.now()
    let first = 0
    const wh = res.writeHead
    res.writeHead = function (...a) {
      first ||= Date.now()
      return wh.apply(this, a)
    }
    const w = res.write
    res.write = function (...a) {
      first ||= Date.now()
      return w.apply(this, a)
    }
    res.on('finish', () => out(`REQ ${t} ${(first || Date.now()) - t} ${Date.now() - t} ${res.statusCode} ${req.method} ${String(req.url).replace(/\?.*/, '')}`))
  }
  return emit.apply(this, arguments)
}
