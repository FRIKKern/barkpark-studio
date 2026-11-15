// Runs .github/workflows/{docs,e2e}.yml locally, for when GitHub Actions can't run
// (e.g. billing). Same env, all seven shards, each on a CI dataset leased as Actions does
// (scripts/ci-lease.mjs: CI runs and this one never share a dataset). Usage, from a PR worktree:
//   node scripts/ci-local.mjs            # prints a summary to paste on the PR
import {execSync} from 'node:child_process'
import fs from 'node:fs'
import {acquire, release} from './ci-lease.mjs'
const primary = process.env.CI_LOCAL_ENV ?? '/Volumes/SATECHI/github/barkpark-studio/.env'
const base = Object.fromEntries(fs.readFileSync(primary, 'utf8').split('\n').filter((l) => /^BARKPARK_(URL|WORKSPACE|PROJECT|TOKEN)=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
// As the workflow: schemas from Barkpark, or from the checkout when this branch changes them.
const fixtureSchemas = execSync('git fetch -q origin main && git diff --name-only origin/main...HEAD -- fixtures/barkpark-schema').toString().trim() !== ''
const env = {...process.env, ...base, CI: 'true', BUDGET_NETWORK_SCALE: '4', ...(fixtureSchemas && {BARKPARK_SCHEMA_SOURCE: 'fixtures'})}
const sh = (cmd, extra = {}, cwd) => execSync(cmd, {stdio: 'inherit', env: {...env, ...extra}, cwd})
// One run per machine (the build and the ports are shared); the datasets are leased per shard.
const LOCK = '/tmp/barkpark-studio-ci-local.lock'
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
for (;;) {
  try { fs.mkdirSync(LOCK); fs.writeFileSync(`${LOCK}/pid`, String(process.pid)); break } catch {}
  const pid = Number(fs.readFileSync(`${LOCK}/pid`, 'utf8') || 0)
  if (!pid || !alive(pid)) { fs.rmSync(LOCK, {recursive: true, force: true}); continue }
  console.error(`ci-local: waiting for run ${pid}…`); execSync('sleep 15')
}
const unlock = () => fs.rmSync(LOCK, {recursive: true, force: true})
process.on('exit', unlock); for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => process.exit(130))
const out = []
sh('node scripts/check-docs.mjs'); out.push('docs: ok')
sh('pnpm --dir app install --frozen-lockfile --silent && pnpm --dir e2e install --frozen-lockfile --silent && pnpm --dir app build')
for (const [shard, home] of [[1, 'ci'], [2, 'ci-2'], [3, 'ci-3'], [4, 'ci-4'], [5, 'ci-5'], [6, 'ci-6'], [7, 'ci-7']]) {
  Object.assign(process.env, base) // the lease reads BARKPARK_* from the env
  const dataset = await acquire({prefer: home})
  try {
  sh('node scripts/seed-barkpark.mjs --data', {BARKPARK_DATASET: dataset})
  const port = 3100 + shard
  const srv = execSync(`(BARKPARK_DATASET=${dataset} STUDIO_SIGN_IN=shared nohup pnpm --dir app exec vite preview --port ${port} --strictPort > /tmp/ci-local-${shard}.log 2>&1 & echo $!)`, {env: {...env, BARKPARK_DATASET: dataset}}).toString().trim()
  try {
    execSync(`for i in $(seq 1 60); do curl -sf http://localhost:${port}/health >/dev/null && exit 0; sleep 1; done; exit 1`, {shell: '/bin/bash'})
    const t = Date.now()
    sh(`node node_modules/@playwright/test/cli.js test $(node ../scripts/shard-files.mjs ${shard} 7) --project=studio`, {BARKPARK_DATASET: dataset, E2E_PORT: String(port), }, 'e2e')
    out.push(`shard ${shard} (${dataset}): pass in ${((Date.now() - t) / 1000).toFixed(1)} s`)
  } finally { try { process.kill(Number(srv)) } catch {} }
  } finally { await release({dataset}) }
}
console.log(`\n### Local CI (Actions billing blocked)\n${out.map((l) => `- ${l}`).join('\n')}\n- commit ${execSync('git rev-parse --short HEAD').toString().trim()}`)
