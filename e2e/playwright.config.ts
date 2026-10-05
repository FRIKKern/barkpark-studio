import {defineConfig} from '@playwright/test'

// Two targets, same specs: `sanity` (reference/sanity, the bar) and `studio` (app/, ours).
// Ours runs its own server on :3100 against BARKPARK_DATASET — `e2e-local` from
// pnpm test, `ci` in GitHub — never the hand-poke `production` your :3000 uses.
// E2E_PORT: one per worktree when several agents run e2e side by side (default 3100).
const PORT = Number(process.env.E2E_PORT || 3100)
const STUDIO = `http://localhost:${PORT}`
// Secrets come from the repo-root .env: run as `node --env-file=../.env node_modules/.bin/playwright test`
// (or `pnpm test`, which does that).
export default defineConfig({
  testDir: '.',
  testMatch: ['*.spec.ts', 'journeys/*.spec.ts'],
  globalSetup: './rig/warmup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: process.env.CI ? 15_000 : 30_000,
  // Fail fast: a run that can't start or hydrate stops instead of timing out test by test.
  maxFailures: process.env.CI ? 3 : 0,
  // QUALITY.md rule 5: the whole suite fits in 60 s; in CI going over fails the run.
  globalTimeout: process.env.CI ? 60_000 : 0,
  reporter: [['list']],
  // @baseline specs measure, they don't gate: only `pnpm baseline` runs them.
  grepInvert: process.env.BASELINE ? undefined : /@baseline/,
  use: {channel: 'chrome', viewport: {width: 1440, height: 900}},
  projects: [
    {name: 'sanity', use: {baseURL: 'http://localhost:3333'}},
    {name: 'studio', use: {baseURL: STUDIO}},
  ],
  // CI runs ours only (the reference needs a Sanity login); side-by-side stays local.
  webServer: [
    ...(process.env.CI ? [] : [{command: 'pnpm --dir ../reference/sanity dev', url: 'http://localhost:3333', reuseExistingServer: true, timeout: 60_000}]),
    // CI times a production build (what users get; built in an earlier step); locally the dev server.
    {
      command: process.env.CI ? `pnpm --dir ../app exec vite preview --port ${PORT} --strictPort` : `pnpm --dir ../app dev --port ${PORT} --strictPort`,
      url: `${STUDIO}/health`,
      // Never reuse: a server already on the port may be another worktree's code.
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
    },
  ],
})
