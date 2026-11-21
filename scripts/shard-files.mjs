// CI's e2e shards by recorded time, not test count (Playwright's --shard): the heavy specs
// spread over the shards, the same way every run. e2e/durations.json holds each spec's CI
// seconds (0: it has no CI test, only @local / @evidence ones); a spec not in it yet, or
// recorded 0 but with a CI test now, counts as the median recorded spec until it is recorded (it was 3 s, and new specs on 2026-10-16 ran
// longer: shard 5 past the 60 s cap on #856 and #863), and the log names it.
//   node scripts/shard-files.mjs 2 4                    # the spec files for shard 2 of 4
//   node scripts/shard-files.mjs --update <run> [<run>…] # re-record from CI runs (gh)
//   node scripts/shard-files.mjs --update <run>:1 <run>:2  # …or attempts of one run (a re-run of the same code)
// A spec's time is wall time: from the line before its test's result to that result, so its
// beforeAll / afterAll hooks count (a test's own "(2.1s)" leaves them out: search-quality's
// seeding was 10 s nobody planned for, and ci-4 ran past the 60 s cap). A failed test is
// left out (a timeout is not its time); a skipped one counts (a skip after a page load cost
// translations.spec 2 s, recorded 0). With several runs each spec takes its median, and
// one that did not run in a timed-out shard still counts from the others.
import {execSync} from 'node:child_process'
import {writeFileSync} from 'node:fs'
import {DURATIONS, plan, specFiles} from './lib/shard-plan.mjs'

if (process.argv[2] === '--update') {
  const runs = process.argv.slice(3)
  // Every spec is recorded, 0 when CI runs none of its tests.
  const secs = Object.fromEntries(specFiles().map((f) => [f, 0]))
  const seen = {}
  for (const run of runs) {
    const inRun = {}
    const [id, attempt] = run.split(':')
    const jobs = execSync(`gh api repos/{owner}/{repo}/actions/runs/${id}${attempt ? `/attempts/${attempt}` : ''}/jobs -q '.jobs[] | select(.name|startswith("studio")) | .id'`).toString().split('\n').filter(Boolean)
    for (const job of jobs) {
      let last = null
      // The job's own log (`gh run view --job --log` reads the run's latest attempt, whatever the job).
      for (const line of execSync(`gh api repos/{owner}/{repo}/actions/jobs/${job}/logs`, {maxBuffer: 64 << 20}).toString().split('\n')) {
        const at = /^\uFEFF?(\d{4}-\d\d-\d\dT[\d:.]+Z) /.exec(line)
        if (!at) continue
        const t = Date.parse(at[1]) / 1000
        if (/Running \d+ tests? using/.test(line)) last = t
        const m = /([✓✘-]) +\d+ \[studio\] › journeys\/([^:]+):\d+:\d+ › /.exec(line)
        if (!m || last === null) continue
        if (m[1] !== '✘') inRun[m[2]] = (inRun[m[2]] ?? 0) + (t - last)
        last = t
      }
    }
    for (const [f, v] of Object.entries(inRun)) (seen[f] ??= []).push(v)
  }
  for (const [f, vs] of Object.entries(seen)) {
    const sorted = vs.sort((a, b) => a - b)
    secs[f] = Math.round(sorted[Math.floor((sorted.length - 1) / 2)] * 10) / 10
  }
  writeFileSync(DURATIONS, `${JSON.stringify(Object.fromEntries(Object.entries(secs).sort()), null, 2)}\n`)
  console.log(`recorded ${Object.keys(secs).length} specs from run(s) ${runs.join(', ')}`)
  process.exit(0)
}

const [n, of] = process.argv.slice(2).map(Number)
if (!(n >= 1 && n <= of)) throw new Error('usage: shard-files.mjs <shard> <shards> | --update <run id>')
const {groups, unknown, median} = plan(of)
if (unknown.length) console.error(`shard-files: not recorded yet (or recorded 0 s, with a CI test now), counted as ${median} s each: ${unknown.join(', ')}`)
console.log(groups[n - 1].files.join(' '))
