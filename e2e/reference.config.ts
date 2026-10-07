import {defineConfig} from '@playwright/test'
import base from './playwright.config'

// P0 reference evidence reuses the crown specs, with no Barkpark server or token.
// A separate dated directory preserves earlier recordings for quality review.
const output = `evidence/reference/${process.env.REFERENCE_RUN_ID || 'manual'}`
const port = process.env.SANITY_PORT || '3333'
export default defineConfig({
  ...base,
  testMatch: ['journeys/panes.spec.ts', 'journeys/refs.spec.ts'],
  grep: /\bJ(08|17|21|22|23):/,
  grepInvert: undefined,
  globalSetup: undefined,
  globalTimeout: 0,
  retries: 0,
  timeout: 180_000,
  outputDir: `${output}/results`,
  preserveOutput: 'always',
  reporter: [['list'], ['html', {outputFolder: `${output}/report`, open: 'never'}]],
  use: {...base.use, video: 'on', launchOptions: {slowMo: 250}},
  projects: [{name: 'sanity', use: {baseURL: `http://localhost:${port}`}}],
  webServer: [{
    command: `pnpm --dir ../reference/sanity dev --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
  }],
})
