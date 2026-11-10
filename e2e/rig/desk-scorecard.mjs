#!/usr/bin/env node
// The desk slice's scorecard as one markdown table: the seven rows journeys/desk-slice-sbs.spec.ts
// records, the Phoenix desk and the TanStack Studio side by side. Reads the JSON each side's run
// left (evidence/, where the spec copies it: test-results/ is emptied by the next run). A side
// with no file prints "not run". The checks and their bars come from the files: the spec owns them.
//   node rig/desk-scorecard.mjs [desk.json] [studio.json] > SCORECARD.md
import {existsSync, readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

const here = (f) => fileURLToPath(new URL(`../evidence/${f}`, import.meta.url))
const [deskFile = here('desk-slice-desk.json'), oursFile = here('desk-slice-studio.json')] = process.argv.slice(2)
const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null)
const desk = read(deskFile)
const ours = read(oursFile)
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
const verdict = (side, n) => {
  if (!side) return 'not run'
  const row = side.rows?.[n]
  return row ? `${row.pass ? 'PASS' : 'FAIL'}: ${row.summary}` : 'not run'
}

/** Rows 1 and 7 also compare the two sides: the same panes per URL, the same strips per width. */
function alike(n) {
  const a = desk?.rows?.[n]
  const b = ours?.rows?.[n]
  if (!a || !b) return ''
  if (n === 1) {
    // Strips are masked: ours draws a strip without its kind.
    const kinds = (u) => u.kinds.map((k) => (k.endsWith('(strip)') ? 'strip' : k)).join(' ')
    const theirs = new Map((b.urls ?? []).map((u) => [u.url, u]))
    const differ = (a.urls ?? []).filter((u) => !theirs.has(u.url) || kinds(theirs.get(u.url)) !== kinds(u))
    return differ.length ? `differ: ${differ.map((u) => u.url).join(', ')}` : `same panes, ${(a.urls ?? []).length} URLs`
  }
  if (n === 7) {
    const key = (l) => `${l.url} @${l.width}`
    const theirs = new Map((b.layouts ?? []).map((l) => [key(l), l.strips.join()]))
    const differ = (a.layouts ?? []).filter((l) => theirs.get(key(l)) !== l.strips.join())
    return differ.length ? `differ at ${differ.map((l) => `${l.width}px`).join(', ')}` : `same strips, ${(a.layouts ?? []).length} layouts`
  }
  return ''
}

const label = (side, file) => (side ? `${side.label} (${side.ran})` : `not run (${file.split('/').pop()})`)
console.log(`Desk slice scorecard. Dataset: ${desk?.dataset ?? ours?.dataset ?? '?'}.\n`)
console.log(`| # | check | pass bar | ${cell(label(desk, deskFile))} | ${cell(label(ours, oursFile))} | the two alike |`)
console.log('|---|---|---|---|---|---|')
for (const n of [1, 2, 3, 4, 5, 6, 7]) {
  const row = desk?.rows?.[n] ?? ours?.rows?.[n]
  console.log(`| ${n} | ${cell(row?.check ?? '')} | ${cell(row?.bar ?? '')} | ${cell(verdict(desk, n))} | ${cell(verdict(ours, n))} | ${cell(alike(n))} |`)
}
