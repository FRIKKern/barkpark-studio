// Run identically in PowerShell, cmd and POSIX shells. Keep the test dataset out
// of the hand-poke production dataset, even when .env names production.
import {existsSync} from 'node:fs'
import {loadEnvFile} from 'node:process'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'

const [mode, ...args] = process.argv.slice(2)
if (!['test', 'baseline', 'evidence', 'reference', 'reset'].includes(mode)) {
  console.error('Usage: node run.mjs test|baseline|evidence|reference|reset [arguments]')
  process.exit(1)
}
process.env.BARKPARK_DATASET ||= 'e2e-local'
const envFile = fileURLToPath(new URL('../.env', import.meta.url))
if (existsSync(envFile)) loadEnvFile(envFile)
if (mode === 'baseline') process.env.BASELINE = '1'
if (mode === 'evidence') process.env.EVIDENCE = '1'
if (mode === 'reference') {
  if (!args.includes('--list') && !args.includes('--help') && !process.env.SANITY_TOKEN) {
    console.error('Reference recording needs SANITY_TOKEN in the repo-root .env or environment. No servers were started.')
    process.exit(1)
  }
  process.env.REFERENCE_RUN_ID = new Date().toISOString().replace(/[:.]/g, '-')
}
const cli = mode === 'reset' ? '../scripts/seed-barkpark.mjs' : 'node_modules/@playwright/test/cli.js'
const flags = mode === 'reset' ? ['--data'] : [
  'test',
  ...(mode === 'baseline' || mode === 'evidence' ? ['--grep', `@${mode}`] : []),
  ...(mode === 'reference' ? ['--config', 'reference.config.ts'] : []),
]
const result = spawnSync(process.execPath, [cli, ...flags, ...args], {
  cwd: fileURLToPath(new URL('.', import.meta.url)), stdio: 'inherit', env: process.env,
})
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
