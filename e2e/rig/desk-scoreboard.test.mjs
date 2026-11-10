// desk-scoreboard (node --test rig/desk-scoreboard.test.mjs): it prints only what a desk run
// measured. DESK_SCOREBOARD=<path> scores with another copy of the script (the old one, to see red).
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdtempSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'

const SCRIPT = process.env.DESK_SCOREBOARD ?? fileURLToPath(new URL('./desk-scoreboard.mjs', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'desk-scoreboard-'))
let n = 0
/** Score one report (an object, or raw text), as the CLI does. */
function score(report) {
  const file = join(dir, `run-${++n}.json`)
  writeFileSync(file, typeof report === 'string' ? report : JSON.stringify(report))
  const r = spawnSync(process.execPath, [SCRIPT, file], {encoding: 'utf8'})
  return {file, status: r.status, out: r.stdout, err: r.stderr}
}
// The shapes Playwright 1.x writes (taken from real reports: a run, a webServer that died).
const result = (status) => ({status, duration: 5, errors: status === 'failed' ? [{message: 'Error: expect(locator).toBeVisible() failed', location: {file: '/e2e/journeys/a.spec.ts', line: 9}}] : []})
const spec = (line, title, {project = 'desk', status = 'passed', annotations = []} = {}) => ({
  title,
  file: 'journeys/a.spec.ts',
  line,
  tests: [{projectName: project, status: status === 'skipped' ? 'skipped' : status === 'passed' ? 'expected' : 'unexpected', annotations, results: [result(status)]}],
})
const report = (specs, errors = []) => ({config: {}, errors, stats: {startTime: '2026-11-10T20:00:00.000Z'}, suites: specs.length ? [{title: 'a.spec.ts', file: 'journeys/a.spec.ts', specs}] : []})

test('a run that died in webServer (errors, no tests) exits non-zero, says why, prints no table', () => {
  const r = score(report([], [{message: 'Error: Process from config.webServer was not able to start. Exit code: 1'}]))
  assert.notEqual(r.status, 0)
  assert.doesNotMatch(r.out, /\|/)
  assert.match(r.err, /webServer was not able to start/)
})

test('a report of another project (studio) is refused: no table, exit non-zero', () => {
  const r = score(report([spec(3, 'J01 opens'), spec(7, 'J02 edits', {project: 'studio'})]))
  assert.notEqual(r.status, 0)
  assert.doesNotMatch(r.out, /\|/)
  assert.match(r.err, /studio/)
})

test('a report that cannot be parsed exits non-zero and names the file', () => {
  const r = score('{"suites": [')
  assert.notEqual(r.status, 0)
  assert.ok(r.err.includes(r.file), r.err)
})

test('a skipped test is in the table as skipped, its journey is not green, the headline counts it', () => {
  const r = score(report([spec(3, 'J01 opens'), spec(5, 'J01 closes', {status: 'skipped', annotations: [{type: 'fixme', description: 'desk: no close'}]}), spec(7, 'J02 edits')]))
  assert.equal(r.status, 0, r.err)
  assert.match(r.out, /2 of 3 tests pass, 1 skipped; 1 of 2 journeys have every test green/)
  assert.match(r.out, /\| J01 \| 1\/2 \|/)
  assert.match(r.out, /\| skipped `a\.spec\.ts:5` J01 closes \| fixme: desk: no close \|/)
})

// The control: passes on the old script too.
test('a desk run with a failure prints its table', () => {
  const r = score(report([spec(3, 'J01 opens'), spec(7, 'J02 edits', {status: 'failed'})]))
  assert.equal(r.status, 0, r.err)
  assert.match(r.out, /1 of 2 tests pass/)
  assert.match(r.out, /1 of 2 journeys have every test green/)
  assert.match(r.out, /\| FAIL `a\.spec\.ts:7` J02 edits \| Error: expect\(locator\)\.toBeVisible\(\) failed \(a\.spec\.ts:9\) \|/)
})
