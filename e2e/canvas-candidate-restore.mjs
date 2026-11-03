// @local: exact editor candidate -> baseline restore through the built Studio's real Freeform loader.
// Build app first. The backend, preview servers, credentials and Paper are disposable loopback fixtures.
import assert from 'node:assert/strict'
import {execFileSync, spawn} from 'node:child_process'
import {createHash, randomBytes} from 'node:crypto'
import {once} from 'node:events'
import {createServer} from 'node:http'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {chromium, expect} from '@playwright/test'

const required = (name) => process.env[name] || (() => { throw new Error(`${name} is required`) })()
const candidateDir = path.resolve(required('STUDIO_EDITOR_CANDIDATE_DIR'))
const baselineDir = path.resolve(required('STUDIO_EDITOR_BASELINE_DIR'))
const evidenceDir = path.resolve(required('STUDIO_EDITOR_RESTORE_EVIDENCE'))
const appDir = fileURLToPath(new URL('../app', import.meta.url))
const repo = fileURLToPath(new URL('../', import.meta.url))
const firstPort = Number(process.env.STUDIO_EDITOR_RESTORE_PORT || 36418)
const scope = '/w/contract/p/default'
const pagePath = `${scope}/d/review/structure/paper;paper-01`
const person = 'synthetic-person-session'
const files = [
  'bp-paper-code.js',
  'bp-paper-editor-shell.css',
  'bp-paper-editor.bundle.js',
  'bp-paper-editor.css',
  'bp-paper-mermaid.js',
  'bp-paper-surface.css',
]
const executable = ['bp-paper-editor.bundle.js', 'bp-paper-editor.css', 'bp-paper-editor-shell.css', 'bp-paper-surface.css']
const bundleName = executable[0]
const styleNames = executable.slice(1)
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function loadAssetSet(name, contract, dir) {
  const declared = new Map((await readFile(path.join(dir, 'SHA256SUMS'), 'utf8')).trim().split('\n').map((line) => {
    const match = /^([a-f0-9]{64})  (bp-paper-[^/]+)$/.exec(line)
    if (!match) throw new Error(`Invalid ${name} SHA256SUMS line: ${line}`)
    return [match[2], match[1]]
  }))
  assert.deepEqual([...declared.keys()].sort(), [...files].sort(), `${name} must declare exactly six browser assets`)
  const assets = Object.fromEntries(await Promise.all(files.map(async (file) => {
    const bytes = await readFile(path.join(dir, file))
    const hash = sha256(bytes)
    assert.equal(hash, declared.get(file), `${name} ${file} differs from its preserved digest`)
    return [file, {bytes, hash, path: `/assets/v/${hash.slice(0, 16)}/${file}`}]
  })))
  return {name, contract, dir, assets}
}

const phases = [
  await loadAssetSet('candidate', '1.22.0', candidateDir),
  await loadAssetSet('restored-baseline', '1.21.0', baselineDir),
]
assert.notEqual(phases[0].assets[bundleName].hash, phases[1].assets[bundleName].hash, 'candidate and baseline executable must differ')

let active = phases[0]
const reads = []
const original = 'Restore rehearsal text'
let blocks = [{id: 'p1', type: 'paragraph', content: [{type: 'text', value: original}]}]
let rev = 1
const receipts = []
const backend = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname
  reads.push([request.method, pathname])
  const reply = (status, body) => {
    response.writeHead(status, {'content-type': 'application/json'})
    response.end(JSON.stringify(body))
  }
  if (pathname === '/v1/embed/canvas') return reply(200, {
    script: active.assets[bundleName].path,
    styles: styleNames.map((name) => active.assets[name].path),
  })
  const asset = Object.entries(active.assets).find(([name, value]) => value.path === pathname || pathname === `/assets/${name}`)
  if (asset) {
    response.writeHead(200, {'content-type': asset[0].endsWith('.css') ? 'text/css' : 'text/javascript', 'cache-control': 'public, max-age=31536000, immutable'})
    response.end(asset[1].bytes)
    return
  }
  if (pathname === '/v1/auth/login' && request.method === 'POST') return reply(201, {token: person, user: {email: 'editor@example.invalid'}})
  if (pathname === '/v1/auth/token') return reply(200, {kind: 'session', user: {id: 'person-id'}, expires_at: null, seats: [{workspace: {id: 'workspace-id', slug: 'contract'}, role: 'member', can: {read: true, write: true, publish: true, admin: false}}]})
  if (pathname === '/v1/auth/me') return reply(200, {user: {display_name: 'Contract editor'}})
  if (pathname.endsWith('/schemas/review')) return reply(200, {schemas: [{name: 'paper', title: 'Paper', fields: [{name: 'title', type: 'string'}]}]})
  if (pathname.endsWith('/v1/papers/paper-01/ops') && request.method === 'POST') {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks))
    const op = body.ops?.[0]
    if (body.ifRev !== rev || body.ops?.length !== 1 || op?.op !== 'patch-block' || op?.id !== 'p1' || !Array.isArray(op?.patch?.content)) {
      return reply(400, {error: {code: 'fixture_unsupported_operation'}})
    }
    blocks = [{...blocks[0], ...op.patch}]
    rev++
    receipts.push({body, rev})
    return reply(200, {rev})
  }
  if (pathname.endsWith('/paper/paper-01')) return reply(200, {result: {
    _id: 'paper-01', _type: 'paper', _rev: `rev-${rev}`, _createdAt: '2026-11-01T00:00:00Z', _updatedAt: '2026-11-01T00:00:00Z',
    rev, title: 'Candidate restore fixture', blocks,
  }})
  if (pathname.includes('/data/query/review')) return reply(200, {result: {documents: [], hasMore: false}})
  return reply(404, {})
})
await new Promise((resolve, reject) => {
  backend.once('error', reject)
  backend.listen(0, '127.0.0.1', resolve)
})

const browser = await chromium.launch()
const evidence = []
try {
  for (const [index, phase] of phases.entries()) {
    active = phase
    reads.length = 0
    const port = firstPort + index
    const origin = `http://127.0.0.1:${port}`
    const env = {
      ...process.env,
      BARKPARK_URL: `http://127.0.0.1:${backend.address().port}`,
      BARKPARK_WORKSPACE: 'contract',
      BARKPARK_PROJECT: 'default',
      BARKPARK_DATASET: 'review',
      STUDIO_SIGN_IN: 'account',
      STUDIO_LOCALE: 'en-US',
      STUDIO_SESSION_SECRET: randomBytes(32).toString('base64'),
    }
    for (const key of ['BARKPARK_TOKEN', 'BARKPARK_SERVICE_TOKEN', 'BARKPARK_ADMIN_TOKEN', 'STUDIO_DEV_LOGIN', 'BARKPARK_SCHEMA_SOURCE']) env[key] = ''
    const app = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd: appDir, env, stdio: 'pipe', detached: true,
    })
    let log = ''
    app.stdout.on('data', (data) => { log += data })
    app.stderr.on('data', (data) => { log += data })
    const context = await browser.newContext()
    try {
      await expect.poll(async () => {
        assert.equal(app.exitCode, null, `Preview stopped: ${log}`)
        return fetch(`${origin}/health`).then((response) => response.ok, () => false)
      }, {timeout: 20_000}).toBe(true)
      const page = await context.newPage()
      const loaded = new Map()
      page.on('response', (response) => {
        const pathname = new URL(response.url()).pathname
        if (executable.some((name) => phase.assets[name].path === pathname)) loaded.set(pathname, response)
      })
      await page.goto(origin + pagePath)
      await expect(page).toHaveURL(/\/login\?redirect=/)
      await page.getByLabel('Your email').fill('editor@example.invalid')
      await page.getByLabel('Password', {exact: true}).fill('synthetic-password')
      await page.getByRole('button', {name: 'Sign in', exact: true}).click()
      await expect(page).toHaveURL(origin + pagePath)
      const freeform = page.getByRole('tab', {name: 'Freeform', exact: true})
      if (await freeform.count()) await freeform.click()
      await expect(page.locator('bp-paper-canvas')).toBeVisible({timeout: 15_000})
      await expect.poll(() => loaded.size).toBe(executable.length)

      const loader = {}
      for (const name of executable) {
        const asset = phase.assets[name]
        const response = loaded.get(asset.path)
        assert.equal(response.status(), 200)
        const hash = sha256(await response.body())
        assert.equal(hash, asset.hash, `${phase.name} Freeform loader response for ${name}`)
        loader[name] = {url: response.url(), sha256: hash}
      }
      const before = index === 0 ? original : `${original} candidate`
      const suffix = index === 0 ? ' candidate' : ' restored'
      await page.locator('bp-paper-canvas').getByText(before, {exact: true}).click()
      await page.keyboard.press('End')
      await page.keyboard.insertText(suffix)
      const after = before + suffix
      await expect.poll(() => blocks[0].content.map((part) => part.value).join(''), {timeout: 10_000}).toBe(after)
      assert.equal(receipts.length, index + 1)
      await page.reload()
      const freeformAgain = page.getByRole('tab', {name: 'Freeform', exact: true})
      if (await freeformAgain.count() && await freeformAgain.getAttribute('aria-selected') === 'false') await freeformAgain.click()
      await expect(page.locator('bp-paper-canvas').getByText(after, {exact: true})).toBeVisible()
      const contract = await page.evaluate(() => customElements.get('bp-paper-editor')?.CONTRACT_VERSION)
      assert.equal(contract, phase.contract)
      assert.ok(reads.some(([method, pathname]) => method === 'GET' && pathname === '/v1/embed/canvas'))
      evidence.push({
        phase: phase.name,
        contract,
        declared: Object.fromEntries(files.map((name) => [name, phase.assets[name].hash])),
        loader,
        receipt: receipts.at(-1),
        restoredText: after,
        reads: [...reads],
      })
      console.log(`PASS ${phase.name} ${contract} ${loader[bundleName].sha256}`)
    } catch (error) {
      console.error(log.slice(-3_000), reads)
      throw error
    } finally {
      await context.close()
      const ended = once(app, 'exit')
      if (app.exitCode === null) process.kill(-app.pid, 'SIGTERM')
      if (app.exitCode === null) await ended
    }
  }
  await mkdir(evidenceDir, {recursive: true})
  await writeFile(path.join(evidenceDir, 'manifest.json'), JSON.stringify({
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim(),
    sourceDirty: execFileSync('git', ['status', '--porcelain', '--', '.', ':(exclude)app/node_modules', ':(exclude)e2e/node_modules'], {cwd: repo, encoding: 'utf8'}).trim() !== '',
    isolation: {loopbackOnly: true, liveMutation: false, backend: `http://127.0.0.1:${backend.address().port}`},
    phases: evidence,
    assertions: [
      'all six candidate and baseline browser assets matched their preserved SHA256SUMS',
      'the built Studio Freeform loader fetched the exact candidate executable and three styles from its connected loopback backend',
      'the built Studio Freeform loader then fetched the exact restored baseline executable and styles',
      'candidate and restored-baseline edits each received a real fixture revision and survived a page reload',
      'production defaults, deployment pins and live Papers were not changed',
    ],
  }, null, 2) + '\n')
  console.log(`Evidence: ${path.join(evidenceDir, 'manifest.json')}`)
} finally {
  await browser.close()
  backend.closeAllConnections()
  await new Promise((resolve) => backend.close(resolve))
}
