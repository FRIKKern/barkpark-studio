import {execSync} from 'node:child_process'
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
    define: {__STUDIO_BUILD__: JSON.stringify(build)},
    // Server-only modules (src/server) imported into client code fail the build, not mock silently.
    plugins: [immutableAssets(), tanstackStart({importProtection: {behavior: 'error', client: {files: ['**/src/server/**']}}}), viteReact()],
  }
})
