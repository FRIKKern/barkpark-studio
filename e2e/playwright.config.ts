import {defineConfig} from '@playwright/test'

// Two targets, same specs: `sanity` (reference/sanity, the bar) and `studio` (app/, ours).
// Secrets come from the repo-root .env: run as `node --env-file=../.env node_modules/.bin/playwright test`
// (or `pnpm test`, which does that).
export default defineConfig({
  testDir: '.',
  testMatch: ['*.spec.ts', 'journeys/*.spec.ts'],
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: [['list']],
  // @baseline specs measure, they don't gate: only `pnpm baseline` runs them.
  grepInvert: process.env.BASELINE ? undefined : /@baseline/,
  use: {channel: 'chrome', viewport: {width: 1440, height: 900}},
  projects: [
    {name: 'sanity', use: {baseURL: 'http://localhost:3333'}},
    {name: 'studio', use: {baseURL: 'http://localhost:3000'}},
  ],
  // CI runs ours only (the reference needs a Sanity login); side-by-side stays local.
  webServer: [
    ...(process.env.CI ? [] : [{command: 'pnpm --dir ../reference/sanity dev', url: 'http://localhost:3333', reuseExistingServer: true, timeout: 60_000}]),
    {command: 'pnpm --dir ../app dev', url: 'http://localhost:3000/health', reuseExistingServer: !process.env.CI, timeout: 60_000, stdout: 'pipe'},
  ],
})
