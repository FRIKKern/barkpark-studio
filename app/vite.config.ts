import {execSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {defineConfig, loadEnv, type Plugin} from 'vite'
import {tanstackStart} from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import {nitro} from 'nitro/vite'
import {parseChanges} from './src/lib/whats-new'

// Cold-load scout (2026-10-09): the production server sent its content-hashed
// /assets/* with `no-cache`, so a warm load fetched all ~230 KB of JS again. A hashed
// file never changes under its name: cache it for a year. The HTML stays revalidated.
const immutableAssets = (): Plugin => ({
  name: 'immutable-hashed-assets',
  configurePreviewServer(server) {
    server.middlewares.use((req, res, next) => {
      if (/^\/assets\/[^/]+-[\w-]{8,}\.(?:js|css|woff2?|svg|png)$/.test(req.url?.split('?')[0] ?? '')) {
        const set = res.setHeader.bind(res)
        res.setHeader = (name, value) => set(name, name.toLowerCase() === 'cache-control' ? 'public, max-age=31536000, immutable' : value)
        set('Cache-Control', 'public, max-age=31536000, immutable')
      }
      next()
    })
  },
})

// task-5bc1c714ee502b84: a fresh server's first page paid the cold costs: its server chunks
// evaluated on first use (the event loop blocked ~300 ms) and a new TLS connection to Barkpark
// per parallel read (40-55 ms each). So the first editor after a deploy waited twice as long
// as the next (0.24 s against 0.12 s locally, ~1 s on a CI runner). At boot the server renders
// one page of each kind for itself and opens a few Barkpark connections (the first page reads
// about four at once; barkpark.ts keeps them 60 s), and /health waits for that, so whoever
// waits for /health (CI, a deploy's switch) starts on a warm server. Twelve, not six
// (task-dbd164306efdcde9): a page's burst reaches 11 reads in flight, and every read past the
// warm ones was a new connection whose lost first SYN cost 1 or 3 s on CI.
const POOL = 12
const warmAtBoot = (): Plugin => ({
  name: 'warm-at-boot',
  configurePreviewServer(server) {
    let ready: Promise<unknown> | undefined
    server.httpServer?.once('listening', () => {
      const at = server.httpServer!.address()
      const base = `http://localhost:${typeof at === 'object' && at ? at.port : 3000}`
      // Each step gives up after 10 s: a Barkpark that is down must not hold /health forever.
      const page = (p: string) => fetch(base + p, {redirect: 'manual', signal: AbortSignal.timeout(10_000)}).then((r) => r.arrayBuffer(), () => undefined)
      ready = (async () => {
        // Signed in or not, these load the structure, document and sign-in code (a page
        // that needs a session answers with the sign-in screen's redirect, no data).
        for (const p of ['/structure/post', '/structure/post;warm-up', '/login']) await page(p)
        // The Barkpark connection pool, on the dispatcher barkpark.ts set while rendering.
        const url = process.env.BARKPARK_URL
        // A warm-up read over 2 s is a lost first SYN (task-0fbe272a366541f4): CI's log says so.
        const warm = async () => {
          const at = Date.now()
          await fetch(`${url}/v1/version`, {signal: AbortSignal.timeout(10_000)}).then((r) => r.arrayBuffer(), () => undefined)
          if (Date.now() - at > 2_000) console.warn(`${new Date().toISOString()} [barkpark] slow warm-up connection: ${Date.now() - at} ms`)
        }
        if (url) await Promise.all(Array.from({length: POOL}, warm))
      })()
    })
    server.middlewares.use((req, _res, next) => (ready && req.url?.startsWith('/health') ? void ready.finally(() => next()) : next()))
  },
})

// task-e290a2a48bef759a: Start's preview handler marks every HTML response `content-encoding:
// identity`, which keeps Vite's compression middleware off it, so a document page's HTML
// (markup plus the router's dehydrated data) went out as ~135 KB instead of ~22 KB gzipped:
// ~0.6 s of Fast 3G before first paint. Our pages are written in one go, not streamed, so
// gzip holds nothing back. If SSR ever streams, revisit this (gzip buffers until the end).
const compressHtml = (): Plugin => ({
  name: 'compress-html',
  configurePreviewServer(server) {
    server.middlewares.use((_req, res, next) => {
      const set = res.setHeader.bind(res)
      res.setHeader = (name, value) => (name.toLowerCase() === 'content-encoding' && value === 'identity' ? res : set(name, value))
      next()
    })
  },
})

// task-3d93a715c9e2e3d6: a document page draws the editors' inputs (image, file, body) in
// its first frame, but their chunk is a dynamic import the browser finds only once the
// page's code has run: on a slow link the first click waited for that fetch after the page
// was interactive. The production server names the chunk (and what it imports) for
// document pages, from the build manifest, so it downloads with the route's code. Dev has
// no manifest and skips it. Same document-page test as components/DocEditors.tsx.
const DOC_PAGE = /^(?:\/w\/[^/]+\/p\/[^/]+(?:\/d\/[^/]+)?)?\/(?:structure\/[^?#]*;|presentation)/
const preloadEditors = (): Plugin => ({
  name: 'preload-doc-editors',
  configurePreviewServer(server) {
    const files: string[] = []
    try {
      const dir = path.resolve(server.config.root, server.config.environments?.client?.build.outDir ?? 'dist/client')
      const manifest = JSON.parse(readFileSync(path.join(dir, '.vite/manifest.json'), 'utf8')) as Record<string, {file: string; imports?: string[]; isEntry?: boolean}>
      // The chunk and what it imports that a document page's own code doesn't (the client
      // entry and the structure / Presentation route chunks, which the head already
      // preloads): named again here, those came first and the page was interactive later.
      const closure = (keys: string[], out = new Set<string>()) => {
        for (const key of keys) if (manifest[key] && !out.has(key)) (out.add(key), closure(manifest[key]!.imports ?? [], out))
        return out
      }
      const page = closure(Object.keys(manifest).filter((key) => manifest[key]!.isEntry || /routes\/(?:structure\/|presentation).*tsr-split/.test(key)))
      // The editors' chunk and the document pane's (task-a8874d0ebb2baa5c), with what they import.
      const entries = ['src/components/doc-editors.ts', 'src/components/doc-pane.ts']
      files.push(...[...closure(entries)].filter((key) => entries.includes(key) || !page.has(key)).map((key) => manifest[key]!.file))
    } catch {
      return // no manifest: nothing to name
    }
    const link = files.map((f) => `</${f}>; rel=modulepreload`).join(', ')
    server.middlewares.use((req, res, next) => {
      if (link && req.method === 'GET' && DOC_PAGE.test(decodeURIComponent(req.url?.split('?')[0] ?? ''))) res.setHeader('Link', link)
      next()
    })
  },
})

// task-2556adc3b100be57: the document pane is a chunk of its own (components/DocPane.tsx), and
// the bundler cut what it shares with the desk into many small chunks: a document page asked
// for 20 files where main asks for 15, each a round trip (vite preview speaks HTTP/1.1). Chunks
// by route instead: what only a document page draws (the pane and what only it and the editors
// use) is one chunk; what it shares with the rest of the studio (the entry, the routes) is another.
const DOC_ROOTS = /src[\\/]components[\\/]doc-(?:pane|editors)\.ts$/
type Info = {isEntry: boolean; importers: readonly string[]; dynamicImporters: readonly string[]}
const rootsOf = (id: string, info: (id: string) => Info | null, seen = new Map<string, Set<string>>()): Set<string> => {
  const known = seen.get(id)
  if (known) return known
  const out = new Set<string>()
  seen.set(id, out)
  const m = info(id)
  if (!m) return out
  if (m.isEntry || m.dynamicImporters.length || !m.importers.length) out.add(id)
  else for (const by of m.importers) for (const r of rootsOf(by, info, seen)) out.add(r)
  return out
}
const routeChunk = (id: string, ctx: {getModuleInfo: (id: string) => Info | null}) => {
  const roots = [...rootsOf(id, (x) => ctx.getModuleInfo(x))]
  if (!roots.length) return null
  const doc = roots.filter((r) => DOC_ROOTS.test(r))
  if (!doc.some((r) => /doc-pane\.ts$/.test(r))) return null
  return doc.length === roots.length ? 'doc-pane' : 'desk-shared'
}

// A Vercel deployment (docs/DEPLOY.md): with NITRO_PRESET=vercel (`pnpm build:vercel`, or any
// build on Vercel) Nitro
// wraps the same server in the Build Output API, app/.vercel/output. Without it the build is
// dist/ for `vite preview` (`pnpm serve`), unchanged. One Node 22 function serves every page and
// API route; 300 s bounds a live stream (lib/live.ts reconnects past it).
const vercel = (): Plugin[] => (process.env.NITRO_PRESET === 'vercel' || process.env.VERCEL === '1' ? (nitro({vercel: {functions: {runtime: 'nodejs22.x', maxDuration: 300}}}) as Plugin[]) : [])

export default defineConfig(({mode}) => {
  // Server-only secrets from the repo-root .env. Not VITE_-prefixed, so they never reach the client bundle.
  Object.assign(process.env, loadEnv(mode, '..', ['BARKPARK_', 'STUDIO_']))
  // J53: this build's id (commit + build time). A server running a newer build
  // answers a different one on /api/version, and open tabs offer to reload.
  const commit = (() => {
    try {
      return execSync('git rev-parse --short HEAD', {stdio: ['ignore', 'pipe', 'ignore']}).toString().trim()
    } catch {
      return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) || 'dev'
    }
  })()
  // One id per build: the config runs once for the client and once for the server
  // bundle, and two Date.now() values made every production tab offer a reload.
  process.env.STUDIO_BUILD ||= `${commit}-${Date.now().toString(36)}`
  const build = process.env.STUDIO_BUILD
  // Help > What's new: this build's latest merged PRs (src/lib/whats-new.ts). A shallow
  // checkout (CI) lists what it has, maybe nothing.
  const changes = (() => {
    try {
      return parseChanges(execSync('git log --first-parent -n 80 --format=%cs%x09%s', {stdio: ['ignore', 'pipe', 'ignore']}).toString())
    } catch {
      return []
    }
  })()
  return {
    server: {port: 3000},
    environments: {client: {build: {manifest: true, rolldownOptions: {output: {codeSplitting: {groups: [{name: routeChunk, includeDependenciesRecursively: false}]}}}}}},
    define: {__STUDIO_BUILD__: JSON.stringify(build), __STUDIO_CHANGES__: JSON.stringify(changes)},
    // Server-only modules (src/server) imported into client code fail the build, not mock silently.
    plugins: [warmAtBoot(), immutableAssets(), compressHtml(), preloadEditors(), tanstackStart({importProtection: {behavior: 'error', client: {files: ['**/src/server/**']}}}), viteReact(), ...vercel()],
  }
})
