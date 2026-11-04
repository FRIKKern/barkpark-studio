// @local: exact editor candidate -> baseline through the built Studio's real Freeform loader.
// Build app first, then run pnpm --dir e2e editor-restore. Required existing inputs:
// STUDIO_EDITOR_CANDIDATE_DIR, STUDIO_EDITOR_BASELINE_DIR: six assets + SHA256SUMS each.
// STUDIO_EDITOR_RESTORE_EVIDENCE: new/empty output directory; STUDIO_EDITOR_RESTORE_PORT defaults to 36418.
// Both phases use the same disposable Paper, fixture revision fences and fresh cookie-only reloads.
// This verifies native persistence plumbing against a fixture, not production API or visual parity.
import assert from 'node:assert/strict'
import {execFileSync, spawn} from 'node:child_process'
import {createHash, randomBytes} from 'node:crypto'
import {once} from 'node:events'
import {createServer} from 'node:http'
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises'
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
assert.ok(Number.isInteger(firstPort) && firstPort > 0 && firstPort < 65535, 'restore port must leave room for both phases')
const scope = '/w/contract/p/default'
const pagePath = `${scope}/d/review/structure/paper;paper-01`
const documentPath = `${scope}/v1/data/doc/review/paper/paper-01`
const person = 'synthetic-person-session'
const files = ['bp-paper-code.js', 'bp-paper-editor-shell.css', 'bp-paper-editor.bundle.js', 'bp-paper-editor.css', 'bp-paper-mermaid.js', 'bp-paper-surface.css']
const executable = ['bp-paper-editor.bundle.js', 'bp-paper-editor.css', 'bp-paper-editor-shell.css', 'bp-paper-surface.css']
const bundleName = executable[0]
const styleNames = executable.slice(1)
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGfoAAAAASUVORK5CYII=', 'base64')

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

// Preflight both sets before opening any socket or browser, including missing-baseline failures.
const phases = [
  await loadAssetSet('candidate', '1.22.0', candidateDir),
  await loadAssetSet('restored-baseline', '1.21.0', baselineDir),
]
assert.notEqual(phases[0].assets[bundleName].hash, phases[1].assets[bundleName].hash, 'candidate and baseline executable must differ')
await mkdir(evidenceDir, {recursive: true})
assert.deepEqual(await readdir(evidenceDir), [], 'use a new or empty evidence directory; preserve prior receipts')

let active = phases[0]
let blocks
let rev = 1
const reads = []
const receipts = []
const servedDocuments = []
const blocked = []
const mutationAttempts = []
const evidence = []
let backend
let preview
let browser
let backendError
let rejectBackendFailure
const backendFailure = new Promise((_, reject) => { rejectBackendFailure = reject })
backendFailure.catch(() => {})
const paper = () => ({
  _id: 'paper-01', _publishedId: 'paper-01', _draft: false, _hasPublished: true,
  _type: 'paper', _rev: `rev-${rev}`, _createdAt: '2026-11-01T00:00:00Z', _updatedAt: '2026-11-01T00:00:00Z',
  rev, title: 'Composite candidate restore fixture', blocks: structuredClone(blocks),
})

// Deliberately narrow fixture patch fold, not a substitute for the product API implementation.
// Only these known blocks and their tested fields may change; full JSON assertions run after every edit.
function applyFixturePatches(current, ops) {
  assert.ok(Array.isArray(ops) && ops.length > 0, 'fixture requires patch operations')
  const next = structuredClone(current)
  const allowed = {'list-1': ['ordered', 'items'], 'card-a': ['slots'], 'image-1': ['src', 'alt', 'width', 'height'], 'callout-1': ['title']}
  const find = (list, id) => {
    for (const block of list) {
      if (block.id === id) return block
      if (Array.isArray(block.blocks)) {
        const child = find(block.blocks, id)
        if (child) return child
      }
    }
  }
  for (const op of ops) {
    assert.equal(op.op, 'patch-block')
    assert.ok(Object.hasOwn(allowed, op.id), 'unexpected fixture block')
    assert.ok(op.patch && typeof op.patch === 'object' && !Array.isArray(op.patch))
    assert.ok(Object.keys(op.patch).length > 0)
    assert.ok(Object.keys(op.patch).every((key) => allowed[op.id].includes(key)), 'unexpected fixture patch field')
    Object.assign(find(next, op.id), op.patch)
  }
  return next
}

async function handleRequest(request, response) {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname
  reads.push([request.method, pathname])
  const reply = (status, body, type = 'application/json') => {
    response.writeHead(status, {'content-type': type, 'cache-control': 'no-store'})
    response.end(type === 'application/json' ? JSON.stringify(body) : body)
  }
  if (pathname === '/v1/auth/login' && request.method === 'POST') return reply(201, {token: person, user: {email: 'editor@example.invalid'}})
  if (pathname.endsWith('/v1/papers/paper-01/ops') && request.method === 'POST') {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks))
    assert.equal(body.ifRev, rev, 'fixture stale revision fence')
    const before = structuredClone(blocks)
    blocks = applyFixturePatches(blocks, body.ops)
    rev++
    const document = paper()
    receipts.push({body, before, document})
    return reply(200, {rev})
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    mutationAttempts.push([request.method, pathname])
    throw new Error(`Unexpected fixture mutation: ${request.method} ${pathname}`)
  }
  if (pathname === '/v1/embed/canvas') return reply(200, {script: active.assets[bundleName].path, styles: styleNames.map((name) => active.assets[name].path)})
  const asset = Object.entries(active.assets).find(([name, value]) => value.path === pathname || pathname === `/assets/${name}`)
  if (asset) return reply(200, asset[1].bytes, asset[0].endsWith('.css') ? 'text/css' : 'text/javascript')
  if (pathname === '/fixture-image.png') return reply(200, imageBytes, 'image/png')
  if (pathname === '/v1/auth/token') return reply(200, {kind: 'session', user: {id: 'person-id'}, expires_at: null, seats: [{workspace: {id: 'workspace-id', slug: 'contract'}, role: 'member', can: {read: true, write: true, publish: true, admin: false}}]})
  if (pathname === '/v1/auth/me') return reply(200, {user: {display_name: 'Contract editor'}})
  if (pathname.endsWith('/schemas/review')) return reply(200, {schemas: [{name: 'paper', title: 'Paper', fields: [{name: 'title', type: 'string'}]}]})
  if (pathname.endsWith('/paper/paper-01')) {
    const document = paper()
    servedDocuments.push({method: request.method, pathname, document})
    return reply(200, {result: document})
  }
  if (pathname.includes('/data/query/review')) return reply(200, {result: {documents: [], hasMore: false}})
  return reply(404, {})
}

async function stopPreview() {
  if (!preview) return
  const child = preview
  preview = undefined
  if (child.exitCode !== null || child.signalCode !== null) return
  const stopped = once(child, 'exit')
  const force = setTimeout(() => child.kill('SIGKILL'), 3_000)
  try {
    child.kill('SIGTERM')
    await stopped
  } finally {
    clearTimeout(force)
  }
}

try {
  backend = createServer((request, response) => {
    void handleRequest(request, response).catch((error) => {
      if (!backendError) {
        backendError = error
        rejectBackendFailure(error)
      }
      if (!response.headersSent) response.writeHead(500, {'content-type': 'application/json'})
      if (!response.writableEnded) response.end(JSON.stringify({error: {code: 'fixture_failed'}}))
    })
  })
  await new Promise((resolve, reject) => {
    backend.once('error', reject)
    backend.listen(0, '127.0.0.1', resolve)
  })
  const backendOrigin = `http://127.0.0.1:${backend.address().port}`
  blocks = [
    {id: 'list-1', type: 'list', ordered: false, items: [[{type: 'text', value: 'First point'}], [{type: 'text', value: 'Second point'}]]},
    {id: 'section-1', type: 'section', layout: {mode: 'grid', tracks: 2, gap: 'md'}, blocks: [
      {id: 'card-a', type: 'card', slots: {title: [{type: 'heading', text: 'Alpha cell'}]}},
      {id: 'card-b', type: 'card', span: 2, slots: {title: [{type: 'heading', text: 'Beta cell'}]}},
    ]},
    {id: 'image-1', type: 'image', src: `${backendOrigin}/fixture-image.png`, alt: 'Cover art', width: 640, height: 360},
    {id: 'callout-1', type: 'callout', tone: 'warning', title: 'Heads up', content: [{type: 'text', value: 'Warning body.'}]},
  ]
  const initial = structuredClone(blocks)
  const expected = structuredClone(blocks)
  const runJourney = async () => {
    browser = await chromium.launch({channel: 'chrome'})
    for (const [index, phase] of phases.entries()) {
      active = phase
      reads.length = 0
      const phaseStart = receipts.length
      const phaseInitial = paper()
      const origin = `http://127.0.0.1:${firstPort + index}`
      const env = {...process.env, BARKPARK_URL: backendOrigin, BARKPARK_WORKSPACE: 'contract', BARKPARK_PROJECT: 'default', BARKPARK_DATASET: 'review', STUDIO_SIGN_IN: 'account', STUDIO_LOCALE: 'en-US', STUDIO_SESSION_SECRET: randomBytes(32).toString('base64')}
      for (const key of ['BARKPARK_TOKEN', 'BARKPARK_SERVICE_TOKEN', 'BARKPARK_ADMIN_TOKEN', 'STUDIO_DEV_LOGIN', 'BARKPARK_SCHEMA_SOURCE']) env[key] = ''
      preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(firstPort + index), '--strictPort'], {cwd: appDir, env, stdio: 'pipe'})
      let log = ''
      let previewError
      preview.on('error', (error) => { previewError = error })
      for (const stream of [preview.stdout, preview.stderr]) stream.on('data', (data) => { log += data })
      let editContext
      let reloadContext
      const newContext = async (cookies) => {
        const context = await browser.newContext({serviceWorkers: 'block', ...(cookies ? {storageState: {cookies, origins: []}} : {})})
        context.setDefaultTimeout(12_000)
        await context.route('**/*', (route) => {
          const url = new URL(route.request().url())
          if ([origin, backendOrigin].includes(url.origin)) return route.continue()
          blocked.push({origin: url.origin, pathname: url.pathname})
          return route.abort('blockedbyclient')
        })
        return context
      }
      const openFreeform = async (page) => {
        const freeform = page.getByRole('tab', {name: 'Freeform', exact: true})
        if (await freeform.count() && await freeform.getAttribute('aria-selected') !== 'true') await freeform.click()
        await expect(page.locator('bp-paper-canvas')).toBeVisible({timeout: 15_000})
      }
      const observeAssets = (page) => {
        const loaded = new Map()
        page.on('response', (response) => {
          const url = new URL(response.url())
          if (url.origin === backendOrigin && executable.some((name) => phase.assets[name].path === url.pathname)) loaded.set(url.pathname, response)
        })
        return loaded
      }
      const verifyAssets = async (loaded) => {
        await expect.poll(() => loaded.size).toBe(executable.length)
        const result = {}
        for (const name of executable) {
          const response = loaded.get(phase.assets[name].path)
          assert.equal(response.status(), 200)
          assert.equal(sha256(await response.body()), phase.assets[name].hash, `${phase.name} ${name} loader bytes`)
          result[name] = {url: response.url(), sha256: phase.assets[name].hash}
        }
        return result
      }
      try {
        await expect.poll(async () => {
          assert.ifError(previewError)
          assert.equal(preview.exitCode, null, `Preview stopped: ${log}`)
          return fetch(`${origin}/health`).then((response) => response.ok, () => false)
        }, {timeout: 20_000}).toBe(true)
        editContext = await newContext()
        const page = await editContext.newPage()
        const loaded = observeAssets(page)
        await page.goto(origin + pagePath)
        await expect(page).toHaveURL(/\/login\?redirect=/)
        await page.getByLabel('Your email').fill('editor@example.invalid')
        await page.getByLabel('Password', {exact: true}).fill('synthetic-password')
        await page.getByRole('button', {name: 'Sign in', exact: true}).click()
        await expect(page).toHaveURL(origin + pagePath)
        await openFreeform(page)
        const loader = await verifyAssets(loaded)
        const contract = await page.evaluate(() => customElements.get('bp-paper-editor')?.CONTRACT_VERSION)
        assert.equal(contract, phase.contract)
        await expect.poll(() => page.locator('.bp-canvas-image-img').evaluate((image) => image.complete && image.naturalWidth)).toBe(1)
        const edits = []
        const checkpoint = async (name, edit, update) => {
          const priorRev = rev
          const priorCount = receipts.length
          const readStart = servedDocuments.length
          await edit()
          await expect.poll(() => receipts.length, {timeout: 15_000}).toBe(priorCount + 1)
          update(expected)
          await expect.poll(() => page.evaluate(() => document.querySelector('bp-paper-canvas').hasPendingChanges()), {timeout: 15_000}).toBe(false)
          assert.ifError(backendError)
          assert.equal(rev, priorRev + 1)
          const receipt = receipts.at(-1)
          assert.equal(receipt.body.ifRev, priorRev)
          assert.deepEqual(receipt.document.blocks, expected, `${phase.name} ${name}: exact intended JSON only`)
          const echo = servedDocuments.slice(readStart).find((read) => read.method === 'GET' && read.pathname === documentPath && read.document.rev === rev)
          assert.ok(echo, 'native save fetched its own acknowledged revision')
          assert.deepEqual(echo.document, receipt.document)
          edits.push({name, receipt, ownRevisionEcho: echo, pendingChanges: false})
          await writeFile(path.join(evidenceDir, `${phase.name}-${name}-dom.html`), await page.locator('bp-paper-canvas').evaluate((el) => el._editor.view.dom.outerHTML))
        }
        const suffix = index === 0 ? ' candidate' : ' restored'
        await checkpoint('list', async () => {
          await page.locator('bp-paper-canvas ul li p').first().click()
          await page.keyboard.press('End')
          await page.keyboard.insertText(suffix)
        }, (value) => { value[0].items[0][0].value += suffix })
        await checkpoint('section-card-title', () => page.getByRole('textbox', {name: 'Card title', exact: true}).first().fill(expected[1].blocks[0].slots.title[0].text + suffix), (value) => { value[1].blocks[0].slots.title[0].text += suffix })
        await page.locator('.bp-canvas-image').hover()
        await checkpoint('image-alt', () => page.getByRole('textbox', {name: 'image alt text', exact: true}).fill(expected[2].alt + suffix), (value) => { value[2].alt += suffix })
        await checkpoint('callout-title', () => page.getByRole('textbox', {name: 'Callout title', exact: true}).fill(expected[3].title + suffix), (value) => { value[3].title += suffix })
        assert.equal(receipts.length, phaseStart + 4)
        assert.deepEqual(blocks, expected)
        const cookies = await editContext.cookies()
        assert.ok(cookies.length > 0)
        await editContext.close()
        editContext = undefined
        const freshReadStart = servedDocuments.length
        reloadContext = await newContext(cookies)
        const reload = await reloadContext.newPage()
        const freshLoaded = observeAssets(reload)
        await reload.goto(origin + pagePath)
        await expect(reload).toHaveURL(origin + pagePath)
        await openFreeform(reload)
        const freshLoader = await verifyAssets(freshLoaded)
        await expect(reload.locator('bp-paper-canvas ul')).toContainText(expected[0].items[0][0].value)
        await expect(reload.getByRole('textbox', {name: 'Card title', exact: true}).first()).toHaveText(expected[1].blocks[0].slots.title[0].text)
        await expect(reload.locator('.bp-canvas-image-img')).toHaveAttribute('alt', expected[2].alt)
        await expect(reload.getByRole('textbox', {name: 'Callout title', exact: true})).toHaveText(expected[3].title)
        const fresh = servedDocuments.slice(freshReadStart).findLast((read) => read.method === 'GET' && read.pathname === documentPath)
        assert.ok(fresh, 'fresh browser fetched the Paper from the backend')
        assert.deepEqual(fresh.document, receipts.at(-1).document)
        assert.deepEqual(fresh.document.blocks, expected)
        assert.equal(await reload.evaluate(() => customElements.get('bp-paper-editor')?.CONTRACT_VERSION), phase.contract)
        assert.ifError(backendError)
        assert.equal(blocked.length, 0)
        assert.equal(mutationAttempts.length, 0)
        evidence.push({phase: phase.name, contract, initialDocument: phaseInitial, declared: Object.fromEntries(files.map((name) => [name, phase.assets[name].hash])), loader, edits, freshReload: {storageOrigins: [], served: fresh, loader: freshLoader}, reads: [...reads]})
        await writeFile(path.join(evidenceDir, `${phase.name}.json`), JSON.stringify(evidence.at(-1), null, 2) + '\n')
        console.log(`PASS ${phase.name} ${contract}: four edits, own revision echoes, fresh cookie-only reload; ${loader[bundleName].sha256}`)
      } finally {
        await editContext?.close()
        await reloadContext?.close()
        await writeFile(path.join(evidenceDir, `${phase.name}-preview.log`), log)
        await stopPreview()
      }
    }
    assert.ifError(backendError)
    await writeFile(path.join(evidenceDir, 'manifest.json'), JSON.stringify({
      sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim(),
      sourceDirty: execFileSync('git', ['status', '--porcelain'], {cwd: repo, encoding: 'utf8'}).trim() !== '',
      harnessSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
      isolation: {loopbackOnly: true, liveMutation: false, backend: backendOrigin, serviceWorkers: 'block', blocked, mutationAttempts},
      fixture: {initial, imageSha256: sha256(imageBytes), patchFold: 'restricted fixture-only shallow patch-block by root/nested id'},
      chrome: browser.version(), phases: evidence,
      assertions: [
        'all six assets in both phases matched SHA256SUMS before launch; actual bundle and three CSS responses matched on initial and fresh loads',
        'four real UI edits in each phase used exact prior-revision fences and native own-revision GET echoes with no pending changes',
        'fresh cookie-only contexts fetched the exact acknowledged whole Paper JSON and rendered all four saved changes',
        'unrelated list items, grid layout/tracks/gap, nested card span, image src/width/height and warning callout tone/body remained exact',
        'the same Paper persisted across candidate and restored-baseline phases; no product defaults, pins or live data changed',
      ],
    }, null, 2) + '\n')
  }
  await Promise.race([runJourney(), backendFailure])
  console.log(`Evidence: ${path.join(evidenceDir, 'manifest.json')}`)
} catch (error) {
  await writeFile(path.join(evidenceDir, 'failure.json'), JSON.stringify({error: error.stack, backendError: backendError?.stack, backend: backend?.address(), previewPid: preview?.pid, receipts, servedDocuments, reads, blocked, mutationAttempts}, null, 2) + '\n')
  throw error
} finally {
  const cleanupErrors = []
  const cleanup = async (name, action) => {
    try { await action() } catch (error) { cleanupErrors.push(new Error(`failed to clean ${name}`, {cause: error})) }
  }
  if (browser) await cleanup('browser', () => browser.close())
  await cleanup('preview', stopPreview)
  if (backend?.listening) await cleanup('backend', async () => {
    backend.closeAllConnections()
    await new Promise((resolve) => backend.close(resolve))
  })
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'editor restore cleanup failed')
}
