// Runs .github/workflows/{docs,e2e}.yml locally, for when GitHub Actions can't run
// (e.g. billing). Same env, both shards (ci, ci-2). Usage, from a PR worktree:
//   node scripts/ci-local.mjs            # prints a summary to paste on the PR
import {execSync} from 'node:child_process'
import fs from 'node:fs'
const primary = process.env.CI_LOCAL_ENV ?? '/Volumes/SATECHI/github/barkpark-studio/.env'
const base = Object.fromEntries(fs.readFileSync(primary, 'utf8').split('\n').filter((l) => /^BARKPARK_(URL|WORKSPACE|PROJECT|TOKEN)=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const env = {...process.env, ...base, CI: 'true', BUDGET_NETWORK_SCALE: '4', BARKPARK_SCHEMA_SOURCE: 'fixtures'}
const sh = (cmd, extra = {}, cwd) => execSync(cmd, {stdio: 'inherit', env: {...env, ...extra}, cwd})
const out = []
sh('node scripts/check-docs.mjs'); out.push('docs: ok')
sh('pnpm --dir app install --frozen-lockfile --silent && pnpm --dir e2e install --frozen-lockfile --silent && pnpm --dir app build')
for (const [shard, dataset] of [[1, 'ci'], [2, 'ci-2']]) {
  sh('node scripts/seed-barkpark.mjs --data', {BARKPARK_DATASET: dataset})
  const port = 3100 + shard
  const srv = execSync(`(BARKPARK_DATASET=${dataset} nohup pnpm --dir app exec vite preview --port ${port} --strictPort > /tmp/ci-local-${shard}.log 2>&1 & echo $!)`, {env: {...env, BARKPARK_DATASET: dataset}}).toString().trim()
  try {
    execSync(`for i in $(seq 1 60); do curl -sf http://localhost:${port}/health >/dev/null && exit 0; sleep 1; done; exit 1`, {shell: '/bin/bash'})
    const t = Date.now()
    sh(`node node_modules/@playwright/test/cli.js test --project studio --shard=${shard}/2`, {BARKPARK_DATASET: dataset, E2E_PORT: String(port), }, 'e2e')
    out.push(`shard ${shard} (${dataset}): pass in ${((Date.now() - t) / 1000).toFixed(1)} s`)
  } finally { try { process.kill(Number(srv)) } catch {} }
}
console.log(`\n### Local CI (Actions billing blocked)\n${out.map((l) => `- ${l}`).join('\n')}\n- commit ${execSync('git rev-parse --short HEAD').toString().trim()}`)
