import {defineConfig, loadEnv} from 'vite'
import {tanstackStart} from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'

export default defineConfig(({mode}) => {
  // Server-only secrets from the repo-root .env. Not VITE_-prefixed, so they never reach the client bundle.
  Object.assign(process.env, loadEnv(mode, '..', 'BARKPARK_'))
  return {
    server: {port: 3000},
    // Server-only modules (src/server) imported into client code fail the build, not mock silently.
    plugins: [tanstackStart({importProtection: {behavior: 'error', client: {files: ['**/src/server/**']}}}), viteReact()],
  }
})
