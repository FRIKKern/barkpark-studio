import {defineConfig} from '@playwright/test'
import base from './playwright.config'

// P0 review footage reuses the journey specs. Each target runs separately so
// the reference needs no Barkpark access and the candidate needs no Sanity login.
const studio = process.env.RECORDING_TARGET === 'studio'
const output = `evidence/${studio ? 'studio' : 'reference'}/${process.env.RECORDING_RUN_ID || 'manual'}`
const port = studio ? process.env.E2E_PORT || '3100' : process.env.SANITY_PORT || '3333'
export default defineConfig({
  ...base,
  testMatch: ['journeys/panes.spec.ts', 'journeys/refs.spec.ts', 'journeys/keyboard.spec.ts'],
  grep: /\bJ(02|08|17|19|21|22|23):/,
  grepInvert: undefined,
  globalSetup: undefined,
  globalTimeout: 0,
  retries: 0,
  timeout: 180_000,
  outputDir: `${output}/results`,
  preserveOutput: 'always',
  reporter: [['list'], ['html', {outputFolder: `${output}/report`, open: 'never'}]],
  // Holds after readiness make candidate footage readable without contaminating
  // its click-to-paint measurements. Approved image comparisons remain in CI;
  // a Windows recording must not create or approve a new screenshot baseline.
  ignoreSnapshots: studio,
  use: {...base.use, video: 'on', launchOptions: {slowMo: studio ? 0 : 250}},
  projects: [{name: studio ? 'studio' : 'sanity', use: {baseURL: `http://localhost:${port}`}}],
  webServer: [{
    command: studio ? `pnpm --dir ../app exec vite preview --port ${port} --strictPort` : `pnpm --dir ../reference/sanity dev --port ${port}`,
    url: `http://localhost:${port}${studio ? '/health' : ''}`,
    reuseExistingServer: false,
    timeout: 60_000,
  }],
})
