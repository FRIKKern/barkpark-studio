import {execSync} from 'node:child_process'
import {defineConfig, loadEnv} from 'vite'
import {tanstackStart} from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'

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
  const build = process.env.STUDIO_BUILD || `${commit}-${Date.now().toString(36)}`
  return {
    server: {port: 3000},
    define: {__STUDIO_BUILD__: JSON.stringify(build)},
    // Server-only modules (src/server) imported into client code fail the build, not mock silently.
    plugins: [tanstackStart({importProtection: {behavior: 'error', client: {files: ['**/src/server/**']}}}), viteReact()],
  }
})
