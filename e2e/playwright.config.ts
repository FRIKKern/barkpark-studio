import {defineConfig} from '@playwright/test'

// Two targets, same specs: `sanity` (reference/sanity, the bar) and `studio` (app/, ours).
// Ours runs its own server on :3100 against BARKPARK_DATASET — `e2e-local` from
// pnpm test, `ci` in GitHub — never the hand-poke `production` your :3000 uses.
// E2E_PORT: one per worktree when several agents run e2e side by side (default 3100).
const PORT = Number(process.env.E2E_PORT || 3100)
const STUDIO = `http://localhost:${PORT}`
// SANITY_PORT: the reference on another port when a worktree changes its schema
// (the project's CORS list has 3333 and 3334).
const SANITY = `http://localhost:${process.env.SANITY_PORT || 3333}`
// PREVIEW_SITE_PORT / PREVIEW_SITE_PORT_BARKPARK: reference/preview-site's Sanity and
// Barkpark copies, one pair per lane (default 3536 / 3537). Set here, the specs, both
// studios' preview origins and the dev server read them (a prod build bakes
// VITE_PREVIEW_ORIGIN in: build with it set).
process.env.PREVIEW_SITE_PORT ||= '3536'
process.env.PREVIEW_SITE_PORT_BARKPARK ||= '3537'
const SITE = `http://localhost:${process.env.PREVIEW_SITE_PORT}`
const SITE_BARKPARK = `http://localhost:${process.env.PREVIEW_SITE_PORT_BARKPARK}`
process.env.SANITY_STUDIO_PREVIEW_ORIGIN ||= SITE
process.env.VITE_PREVIEW_ORIGIN ||= SITE_BARKPARK
// Secrets come from the repo-root .env: run as `node --env-file=../.env node_modules/.bin/playwright test`
// (or `pnpm test`, which does that).
export default defineConfig({
  testDir: '.',
  testMatch: ['*.spec.ts', 'journeys/*.spec.ts'],
  globalSetup: './rig/warmup.ts',
  globalTeardown: './rig/feel-summary.ts',
  // CI hands each shard its spec files by recorded time (scripts/shard-files.mjs), each
  // shard under 60 s. One worker either way: tests still run one at a time.
  fullyParallel: !!process.env.CI,
  workers: 1,
  timeout: process.env.CI ? 15_000 : 30_000,
  // Fail fast: a run that can't start or hydrate stops instead of timing out test by test.
  maxFailures: process.env.CI ? 3 : 0,
  // QUALITY.md rule 5: the whole suite fits in 60 s; in CI going over fails the run.
  globalTimeout: process.env.CI ? 60_000 : 0,
  reporter: [['list']],
  // @baseline specs measure and @evidence specs take side-by-side stills and clips;
  // neither gates: only `pnpm baseline` / `pnpm evidence` run them. @local specs
  // (journeys outside QUALITY.md rule 5) run in `pnpm test`, not in CI's budget.
  grepInvert: process.env.BASELINE || process.env.EVIDENCE ? undefined : process.env.CI ? /@baseline|@evidence|@local/ : /@baseline|@evidence/,
  use: {channel: 'chrome', viewport: {width: 1440, height: 900}},
  projects: [
    {name: 'sanity', use: {baseURL: SANITY}},
    {name: 'studio', use: {baseURL: STUDIO}},
  ],
  // CI runs ours only (the reference needs a Sanity login); side-by-side stays local.
  webServer: [
    ...(process.env.CI ? [] : [{command: `pnpm --dir ../reference/sanity dev --port ${process.env.SANITY_PORT || 3333}`, url: SANITY, reuseExistingServer: true, timeout: 60_000}]),
    // J58–J64: the site Presentation shows, on both sides (reference/preview-site).
    // Sanity's on SITE, ours from Barkpark on SITE_BARKPARK (same pages, this run's dataset).
    ...(process.env.CI ? [] : [
      {command: 'pnpm --dir ../reference/preview-site dev', url: SITE, reuseExistingServer: true, timeout: 60_000, env: {...process.env, SANITY_STUDIO_URL: SANITY, PREVIEW_PORT: process.env.PREVIEW_SITE_PORT} as Record<string, string>},
      {command: 'pnpm --dir ../reference/preview-site dev', url: SITE_BARKPARK, reuseExistingServer: false, timeout: 60_000, env: {...process.env, PREVIEW_SOURCE: 'barkpark', PREVIEW_PORT: process.env.PREVIEW_SITE_PORT_BARKPARK, PREVIEW_DATASET: process.env.BARKPARK_DATASET ?? 'e2e-local'} as Record<string, string>},
    ]),
    // CI times a production build (what users get; built in an earlier step); locally the
    // dev server, or the build with E2E_PROD=1 (perf evidence: dev React is far slower).
    {
      command: process.env.CI || process.env.E2E_PROD ? `pnpm --dir ../app exec vite preview --port ${PORT} --strictPort` : `pnpm --dir ../app dev --port ${PORT} --strictPort`,
      url: `${STUDIO}/health`,
      // Locally never reuse: a server already on the port may be another worktree's
      // code. CI starts it in an earlier step (server boot is outside the budget).
      reuseExistingServer: !!process.env.CI,
      timeout: 60_000,
      stdout: 'pipe',
      // A local lane's studio server writes on its own token (scripts/lane-token.mjs).
      ...(process.env.BARKPARK_APP_TOKEN ? {env: {...process.env, BARKPARK_TOKEN: process.env.BARKPARK_APP_TOKEN} as Record<string, string>} : {}),
    },
  ],
})
