import {execSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {defineConfig, loadEnv, type Plugin} from 'vite'
import {tanstackStart} from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'

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
      const entry = 'src/components/doc-editors.ts'
      files.push(...[...closure([entry])].filter((key) => key === entry || !page.has(key)).map((key) => manifest[key]!.file))
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

export default defineConfig(({mode}) => {
  // Server-only secrets from the repo-root .env. Not VITE_-prefixed, so they never reach the client bundle.
  Object.assign(process.env, loadEnv(mode, '..', ['BARKPARK_', 'STUDIO_']))
  // J53: this build's id (commit + build time). A server running a newer build
  // answers a different one on /api/version, and open tabs offer to reload.
  const commit = (() => {
    try {
      return execSync('git rev-parse --short HEAD', {stdio: ['ignore', 'pipe', 'ignore']}).toString().trim()
    } catch {
      return 'dev'
    }
  })()
  // One id per build: the config runs once for the client and once for the server
  // bundle, and two Date.now() values made every production tab offer a reload.
  process.env.STUDIO_BUILD ||= `${commit}-${Date.now().toString(36)}`
  const build = process.env.STUDIO_BUILD
  return {
    server: {port: 3000},
    environments: {client: {build: {manifest: true}}},
    define: {__STUDIO_BUILD__: JSON.stringify(build)},
    // Server-only modules (src/server) imported into client code fail the build, not mock silently.
    plugins: [immutableAssets(), preloadEditors(), tanstackStart({importProtection: {behavior: 'error', client: {files: ['**/src/server/**']}}}), viteReact()],
  }
})
