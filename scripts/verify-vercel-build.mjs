// Checks what `pnpm --dir app build:vercel` emitted (docs/DEPLOY.md): the Build Output API
// layout, one Node 22 streaming function, and that function answering /api/version and the
// sign-in page. Barkpark is a loopback stub and every credential synthetic: no network, no
// deployment. Run from the repo root after the build: node scripts/verify-vercel-build.mjs
import assert from 'node:assert/strict'
import {existsSync, readFileSync} from 'node:fs'
import {createServer} from 'node:http'
import {join} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

const output = fileURLToPath(new URL('../app/.vercel/output/', import.meta.url))
const json = (path) => JSON.parse(readFileSync(join(output, path), 'utf8'))
assert.ok(existsSync(output), 'No app/.vercel/output: run `pnpm --dir app build:vercel` first')
const config = json('config.json')
assert.equal(config.version, 3)
assert.ok(config.routes.some((r) => r.src === '/(.*)' && r.dest === '/__server'), 'missing the SSR/API catch-all route')
const fn = json('functions/__server.func/.vc-config.json')
assert.equal(fn.runtime, 'nodejs22.x')
assert.equal(fn.supportsResponseStreaming, true)
assert.ok(existsSync(join(output, 'static/assets')), 'missing static assets')

const backend = createServer((_req, res) => (res.writeHead(404, {'content-type': 'application/json'}), res.end('{}')))
await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve))
Object.assign(process.env, {VERCEL: '1', BARKPARK_URL: `http://127.0.0.1:${backend.address().port}`, BARKPARK_WORKSPACE: 'verify', BARKPARK_TOKEN: 'synthetic', STUDIO_SIGN_IN: 'account', STUDIO_SESSION_SECRET: 'v'.repeat(44)})
try {
  const {default: app} = await import(pathToFileURL(join(output, 'functions/__server.func', fn.handler)).href)
  const get = (path) => app.fetch(new Request(`https://verify.invalid${path}`, {redirect: 'manual'}))
  const version = await get('/api/version')
  assert.equal(version.status, 200)
  assert.ok((await version.json()).build, '/api/version names no build')
  const signedOut = await get('/structure')
  assert.equal(signedOut.status, 307, 'signed out, a page sends you to sign in')
  const login = await get('/login?redirect=%2Fstructure')
  assert.equal(login.status, 200)
  assert.match(await login.text(), /<html/)
  console.log('Vercel output verified: Build Output v3, Node 22 streaming function, /api/version, sign-in page.')
} finally {
  backend.close()
}
process.exit(0)
