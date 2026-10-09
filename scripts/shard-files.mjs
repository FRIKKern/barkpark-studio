// CI's e2e shards by recorded time, not test count (Playwright's --shard): the heavy specs
// spread over the shards, the same way every run. e2e/durations.json holds each spec's CI
// seconds (0: it has no CI test, only @local / @evidence ones); a spec not in it yet counts
// as 3 s until it is recorded.
//   node scripts/shard-files.mjs 2 4              # the spec files for shard 2 of 4
//   node scripts/shard-files.mjs --update <run>   # re-record from a green CI run (gh)
import {execSync} from 'node:child_process'
import {readdirSync, readFileSync, writeFileSync} from 'node:fs'

const FILE = new URL('../e2e/durations.json', import.meta.url)
const UNKNOWN = 3

if (process.argv[2] === '--update') {
  const run = process.argv[3]
  const jobs = execSync(`gh api repos/{owner}/{repo}/actions/runs/${run}/jobs -q '.jobs[] | select(.name|startswith("studio")) | .id'`).toString().split('\n').filter(Boolean)
  // Every spec is recorded, 0 when CI runs none of its tests.
  const secs = Object.fromEntries(readdirSync(new URL('../e2e/journeys/', import.meta.url)).filter((f) => f.endsWith('.spec.ts')).map((f) => [f, 0]))
  for (const job of jobs)
    for (const line of execSync(`gh run view --job ${job} --log`, {maxBuffer: 64 << 20}).toString().split('\n')) {
      const m = /› journeys\/([^:]+):\d+:\d+ › .*\((\d+(?:\.\d+)?)(m?s)\)$/.exec(line)
      if (m) secs[m[1]] = Math.round(((secs[m[1]] ?? 0) + Number(m[2]) / (m[3] === 'ms' ? 1000 : 1)) * 10) / 10
    }
  writeFileSync(FILE, `${JSON.stringify(Object.fromEntries(Object.entries(secs).sort()), null, 2)}\n`)
  console.log(`recorded ${Object.keys(secs).length} specs from run ${run}`)
  process.exit(0)
}

const [n, of] = process.argv.slice(2).map(Number)
if (!(n >= 1 && n <= of)) throw new Error('usage: shard-files.mjs <shard> <shards> | --update <run id>')
const secs = JSON.parse(readFileSync(FILE, 'utf8'))
const specs = readdirSync(new URL('../e2e/journeys/', import.meta.url)).filter((f) => f.endsWith('.spec.ts'))
// Heaviest first, each onto the lightest shard so far (ties: the lower shard, then by name).
const bins = Array.from({length: of}, () => ({secs: 0, files: []}))
for (const f of specs.sort((a, b) => (secs[b] ?? UNKNOWN) - (secs[a] ?? UNKNOWN) || a.localeCompare(b))) {
  const bin = bins.reduce((min, b) => (b.secs < min.secs ? b : min))
  bin.secs += secs[f] ?? UNKNOWN
  bin.files.push(`journeys/${f}`)
}
console.log(bins[n - 1].files.join(' '))
