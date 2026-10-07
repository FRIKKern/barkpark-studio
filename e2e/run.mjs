// Run identically in PowerShell, cmd and POSIX shells. Keep the test dataset out
// of the hand-poke production dataset, even when .env names production.
import {existsSync} from 'node:fs'
import {loadEnvFile} from 'node:process'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'

const [mode, ...args] = process.argv.slice(2)
if (!['test', 'baseline', 'evidence', 'reference', 'recording', 'reset'].includes(mode)) {
  console.error('Usage: node run.mjs test|baseline|evidence|reference|recording|reset [arguments]')
  process.exit(1)
}
process.env.BARKPARK_DATASET ||= 'e2e-local'
const envFile = fileURLToPath(new URL('../.env', import.meta.url))
if (existsSync(envFile)) loadEnvFile(envFile)
process.env.SANITY_TOKEN ||= process.env.SANITY_AUTH_TOKEN || ''
if (mode === 'baseline') process.env.BASELINE = '1'
if (mode === 'evidence') process.env.EVIDENCE = '1'
if (mode === 'reference') {
  if (!args.includes('--list') && !args.includes('--help') && !process.env.SANITY_TOKEN) {
    const cli = fileURLToPath(new URL('../reference/sanity/node_modules/sanity/bin/sanity', import.meta.url))
    if (process.env.REFERENCE_CLI_ATTEMPT || !existsSync(cli)) {
      console.error('Reference recording needs a Sanity CLI login. Install reference/sanity dependencies and run sanity login there, or set SANITY_TOKEN. No servers were started.')
      process.exit(1)
    }
    // The supported CLI command supplies its saved login only to the child
    // environment. Never print the token or write a second copy to .env.
    const result = spawnSync(process.execPath, [cli, 'exec', fileURLToPath(import.meta.url), '--with-user-token', '--', mode, ...args], {
      cwd: fileURLToPath(new URL('../reference/sanity/', import.meta.url)),
      stdio: 'inherit', env: {...process.env, REFERENCE_CLI_ATTEMPT: '1'},
    })
    if (result.error) console.error(result.error.message)
    process.exit(result.status ?? 1)
  }
}
if (mode === 'reference' || mode === 'recording') {
  process.env.RECORDING_RUN_ID = new Date().toISOString().replace(/[:.]/g, '-')
  process.env.RECORDING_TARGET = mode === 'recording' ? 'studio' : 'sanity'
  if (mode === 'recording' && !/^(?:e2e-local(?:-[a-z0-9-]+)?|ci)$/.test(process.env.BARKPARK_DATASET)) {
    console.error('Candidate recordings write fixture data: use e2e-local, an e2e-local-* dataset, or ci, never production.')
    process.exit(1)
  }
}
const cli = mode === 'reset' ? '../scripts/seed-barkpark.mjs' : 'node_modules/@playwright/test/cli.js'
const flags = mode === 'reset' ? ['--data'] : [
  'test',
  ...(mode === 'baseline' || mode === 'evidence' ? ['--grep', `@${mode}`] : []),
  ...(mode === 'reference' || mode === 'recording' ? ['--config', 'reference.config.ts'] : []),
]
const result = spawnSync(process.execPath, [cli, ...flags, ...args], {
  cwd: fileURLToPath(new URL('.', import.meta.url)), stdio: 'inherit', env: process.env,
})
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
