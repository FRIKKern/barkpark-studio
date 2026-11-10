#!/usr/bin/env node
// A desk run as a table: per journey, how many of its tests pass on the Phoenix desk, and
// for each one that fails the first thing that stopped it. Reads Playwright's JSON reports
// (`PLAYWRIGHT_JSON_OUTPUT_NAME=run.json pnpm desk … --reporter=list,json`), newest last: a
// test in several reports counts as its last run.
//   node rig/desk-scoreboard.mjs run1.json [run2.json …] [--notes notes.json] > SCOREBOARD.md
// notes.json: {"journeys/panes.spec.ts:37": "who owns the fix: what is missing"}, by hand.
import {readFileSync} from 'node:fs'

const args = process.argv.slice(2)
const at = args.indexOf('--notes')
const notes = at < 0 ? {} : JSON.parse(readFileSync(args.splice(at, 2)[1], 'utf8'))
if (!args.length) {
  console.error('Usage: node rig/desk-scoreboard.mjs run.json [more.json …] [--notes notes.json]')
  process.exit(1)
}

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

const tests = new Map()
let ran = ''
for (const file of args) {
  const report = JSON.parse(readFileSync(file, 'utf8'))
  ran = report.stats?.startTime ?? ran
  for (const spec of report.suites.flatMap(specs)) {
    const result = spec.tests[0]?.results.at(-1)
    if (!result) continue
    const key = `${spec.file}:${spec.line}`
    tests.set(key, {key, title: spec.title, status: result.status, ms: result.duration, why: result.status === 'passed' ? '' : reason(result)})
  }
}

const journeys = new Map()
for (const t of tests.values()) {
  if (t.status === 'skipped') continue
  for (const id of new Set(t.title.match(/\b[JBD]\d{2}\b/g) ?? ['(no id)'])) journeys.set(id, [...(journeys.get(id) ?? []), t])
}
const order = (id) => ('JBD('.indexOf(id[0]) * 100 + (Number(id.slice(1)) || 0))
const ids = [...journeys.keys()].sort((a, b) => order(a) - order(b))
const all = [...tests.values()].filter((t) => t.status !== 'skipped')
const passed = (list) => list.filter((t) => t.status === 'passed').length

console.log(`run of ${ran}: ${passed(all)} of ${all.length} tests pass; ${ids.filter((id) => passed(journeys.get(id)) === journeys.get(id).length).length} of ${ids.length} journeys have every test green\n`)
console.log('| journey | passing | test | what stops it | owner: what is missing |')
console.log('|---|---|---|---|---|')
for (const id of ids) {
  const list = journeys.get(id)
  list.forEach((t, i) => console.log(`| ${i ? '' : id} | ${i ? '' : `${passed(list)}/${list.length}`} | ${t.status === 'passed' ? 'pass' : 'FAIL'} \`${t.key.replace('journeys/', '')}\` ${t.title.replace(/\|/g, '\\|').slice(0, 70)} | ${t.why} | ${t.status === 'passed' ? '' : (notes[t.key] ?? '')} |`))
}
