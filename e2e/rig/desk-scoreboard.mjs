#!/usr/bin/env node
// A desk run as a table: per journey, how many of its tests pass on the Phoenix desk, and
// for each one that fails the first thing that stopped it. Reads Playwright's JSON reports
// (`PLAYWRIGHT_JSON_OUTPUT_NAME=run.json pnpm desk … --reporter=list,json`), newest last: a
// test in several reports counts as its last run.
//   node rig/desk-scoreboard.mjs run1.json [run2.json …] [--notes notes.json] > SCOREBOARD.md
// notes.json: {"journeys/panes.spec.ts:37": "who owns the fix: what is missing"}, by hand.
//
// It prints only what a desk run measured: a report with run errors (webServer, globalSetup,
// a spec that would not load), with no tests, or with a test of another project is refused,
// exit 1 and no table. A skipped test stays in the table and its journey is not green.
import {readFileSync} from 'node:fs'

function refuse(msg) {
  console.error(`desk-scoreboard: ${msg}`)
  process.exit(1)
}
const read = (file) => {
  let json
  try {
    json = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    refuse(`cannot read ${file}: ${e.message}`)
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) refuse(`cannot read ${file}: not a JSON object`)
  return json
}

const args = process.argv.slice(2)
const at = args.indexOf('--notes')
const notes = at < 0 ? {} : read(args.splice(at, 2)[1])
if (!args.length) refuse('usage: node rig/desk-scoreboard.mjs run.json [more.json …] [--notes notes.json]')

/** Every spec of a report, whatever describe it sits in. */
const specs = (suite) => [...(suite.specs ?? []), ...(suite.suites ?? []).flatMap(specs)]
const plain = (s) => (s ?? '').replace(/\u001b\[[0-9;]*m/g, '')
/** What stopped a test, in one line: the error that says most (a bare timeout says least). */
function reason(result) {
  const errors = (result.errors ?? []).map((e) => ({text: plain(e.message), line: e.location?.line, file: e.location?.file}))
  const best = errors.find((e) => !/^Test timeout of/.test(e.text)) ?? errors[0]
  if (!best) return result.status
  const lines = best.text.split('\n').map((l) => l.trim()).filter(Boolean)
  const keep = lines.filter((l, i) => i === 0 || /^(Locator|Expected|Received|waiting for|- waiting for|Error:)/.test(l)).slice(0, 4).join(' · ')
  // An error thrown in the page has no spec line of its own: the test's failing line then.
  const at = /\.spec\.ts$/.test(best.file ?? '') ? best : (result.errorLocation ?? best)
  const where = at.file && at.line ? ` (${at.file.split('/').pop()}:${at.line})` : ''
  return (errors.some((e) => /^Test timeout of/.test(e.text)) && best !== errors[0] ? 'timed out: ' : '') + keep.replace(/\|/g, '\\|').slice(0, 260) + where
}
/** Why a test did not run: its skip or fixme annotation. */
const skipped = (test) => {
  const a = (test.annotations ?? []).find((x) => x.type === 'skip' || x.type === 'fixme')
  return a ? `${a.type}${a.description ? `: ${a.description.replace(/\|/g, '\\|')}` : ''}` : 'did not run'
}

const tests = new Map()
let ran = ''
for (const file of args) {
  const report = read(file)
  if (report.errors?.length) refuse(`${file}: the run failed before or around its tests, nothing to score:\n${report.errors.map((e) => `  ${plain(e.message).split('\n')[0]}`).join('\n')}`)
  const found = (report.suites ?? []).flatMap(specs).flatMap((spec) => (spec.tests ?? []).map((test) => ({spec, test})))
  if (!found.length) refuse(`${file}: no tests in this report, nothing to score`)
  const other = found.find(({test}) => test.projectName !== 'desk')
  if (other) refuse(`${file}: a test of project "${other.test.projectName}" (${other.spec.file}:${other.spec.line}); this scores desk runs only (pnpm desk)`)
  ran = report.stats?.startTime ?? ran
  for (const {spec, test} of found) {
    const result = test.results?.at(-1)
    const status = !result || test.status === 'skipped' ? 'skipped' : result.status
    const key = `${spec.file}:${spec.line}`
    tests.set(key, {key, title: spec.title, status, why: status === 'passed' ? '' : status === 'skipped' ? skipped(test) : reason(result)})
  }
}

const journeys = new Map()
for (const t of tests.values()) for (const id of new Set(t.title.match(/\b[JBD]\d{2}\b/g) ?? ['(no id)'])) journeys.set(id, [...(journeys.get(id) ?? []), t])
const order = (id) => ('JBD('.indexOf(id[0]) * 100 + (Number(id.slice(1)) || 0))
const ids = [...journeys.keys()].sort((a, b) => order(a) - order(b))
const all = [...tests.values()]
const count = (list, status) => list.filter((t) => t.status === status).length
const mark = {passed: 'pass', skipped: 'skipped'}

console.log(`run of ${ran}: ${count(all, 'passed')} of ${all.length} tests pass, ${count(all, 'skipped')} skipped; ${ids.filter((id) => count(journeys.get(id), 'passed') === journeys.get(id).length).length} of ${ids.length} journeys have every test green\n`)
console.log('| journey | passing | test | what stops it | owner: what is missing |')
console.log('|---|---|---|---|---|')
for (const id of ids) {
  const list = journeys.get(id)
  list.forEach((t, i) => console.log(`| ${i ? '' : id} | ${i ? '' : `${count(list, 'passed')}/${list.length}`} | ${mark[t.status] ?? 'FAIL'} \`${t.key.replace('journeys/', '')}\` ${t.title.replace(/\|/g, '\\|').slice(0, 70)} | ${t.why} | ${t.status === 'passed' ? '' : (notes[t.key] ?? '')} |`))
}
