// CI's e2e shards by recorded time, not test count (Playwright's --shard): the heavy specs
// spread over the shards, the same way every run. e2e/durations.json holds each spec's CI
// seconds (0: it has no CI test, only @local / @evidence ones); a spec not in it yet counts
// as the median recorded spec until it is recorded (it was 3 s, and new specs on 2026-10-16 ran
// longer: shard 5 past the 60 s cap on #856 and #863), and the log names it.
//   node scripts/shard-files.mjs 2 4                    # the spec files for shard 2 of 4
//   node scripts/shard-files.mjs --update <run> [<run>…] # re-record from CI runs (gh)
// A spec's time is wall time: from the line before its test's result to that result, so its
// beforeAll / afterAll hooks count (a test's own "(2.1s)" leaves them out: search-quality's
// seeding was 10 s nobody planned for, and ci-4 ran past the 60 s cap). A failed test is
// left out (a timeout is not its time). With several runs each spec takes its median, and
// one that did not run in a timed-out shard still counts from the others.
import {execSync} from 'node:child_process'
import {readdirSync, readFileSync, writeFileSync} from 'node:fs'

const FILE = new URL('../e2e/durations.json', import.meta.url)

if (process.argv[2] === '--update') {
  const runs = process.argv.slice(3)
  // Every spec is recorded, 0 when CI runs none of its tests.
  const secs = Object.fromEntries(readdirSync(new URL('../e2e/journeys/', import.meta.url)).filter((f) => f.endsWith('.spec.ts')).map((f) => [f, 0]))
  const seen = {}
  for (const run of runs) {
    const inRun = {}
    const jobs = execSync(`gh api repos/{owner}/{repo}/actions/runs/${run}/jobs -q '.jobs[] | select(.name|startswith("studio")) | .id'`).toString().split('\n').filter(Boolean)
    for (const job of jobs) {
      let last = null
      for (const line of execSync(`gh run view --job ${job} --log`, {maxBuffer: 64 << 20}).toString().split('\n')) {
        const at = /\t(\d{4}-\d\d-\d\dT[\d:.]+Z) /.exec(line)
        if (!at) continue
        const t = Date.parse(at[1]) / 1000
        if (/Running \d+ tests? using/.test(line)) last = t
        const m = /([✓✘]) +\d+ \[studio\] › journeys\/([^:]+):\d+:\d+ › /.exec(line)
        if (!m || last === null) continue
        if (m[1] === '✓') inRun[m[2]] = (inRun[m[2]] ?? 0) + (t - last)
        last = t
      }
    }
    for (const [f, v] of Object.entries(inRun)) (seen[f] ??= []).push(v)
  }
  for (const [f, vs] of Object.entries(seen)) {
    const sorted = vs.sort((a, b) => a - b)
    secs[f] = Math.round(sorted[Math.floor((sorted.length - 1) / 2)] * 10) / 10
  }
  writeFileSync(FILE, `${JSON.stringify(Object.fromEntries(Object.entries(secs).sort()), null, 2)}\n`)
  console.log(`recorded ${Object.keys(secs).length} specs from run(s) ${runs.join(', ')}`)
  process.exit(0)
}

const [n, of] = process.argv.slice(2).map(Number)
if (!(n >= 1 && n <= of)) throw new Error('usage: shard-files.mjs <shard> <shards> | --update <run id>')
const secs = JSON.parse(readFileSync(FILE, 'utf8'))
const specs = readdirSync(new URL('../e2e/journeys/', import.meta.url)).filter((f) => f.endsWith('.spec.ts'))
const ran = Object.values(secs).filter((v) => v > 0).sort((a, b) => a - b)
const UNKNOWN = ran.length ? ran[Math.floor(ran.length / 2)] : 3
const unknown = specs.filter((f) => !(f in secs))
if (unknown.length) console.error(`shard-files: not in e2e/durations.json yet, counted as ${UNKNOWN} s each: ${unknown.join(', ')}`)
// Heaviest first, each onto the lightest shard so far (ties: the lower shard, then by name).
const bins = Array.from({length: of}, () => ({secs: 0, files: []}))
for (const f of specs.sort((a, b) => (secs[b] ?? UNKNOWN) - (secs[a] ?? UNKNOWN) || a.localeCompare(b))) {
  const bin = bins.reduce((min, b) => (b.secs < min.secs ? b : min))
  bin.secs += secs[f] ?? UNKNOWN
  bin.files.push(`journeys/${f}`)
}
console.log(bins[n - 1].files.join(' '))
