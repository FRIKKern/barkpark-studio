// Answers fixtures/slugify-nb-cases.json with HSO's own norskSlug, so options.slugify "nb"
// (app/src/lib/slugify.ts) can be checked against it (app/src/lib/slug.test.ts):
//   node scripts/slugify-nb-cases.mjs <hovinbyen-ny checkout>
// then commit the rewritten fixture. norskSlug cuts at 96, so every case is at maxLength 96.
// Only the answers and the "answeredBy" line move; add a case by adding {"in": "..."}.
import {execFileSync} from 'node:child_process'
import {readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'

const [hso] = process.argv.slice(2)
if (!hso) throw new Error('usage: node scripts/slugify-nb-cases.mjs <hovinbyen-ny checkout>')
const file = 'src/sanity/norskSlug.ts'
const {norskSlug} = await import(pathToFileURL(join(hso, file)).href)
const sha = execFileSync('git', ['-C', hso, 'log', '-1', '--format=%h', '--', file], {encoding: 'utf8'}).trim()
const path = new URL('../fixtures/slugify-nb-cases.json', import.meta.url)
const fixture = JSON.parse(readFileSync(path, 'utf8'))
fixture.answeredBy = `hovinbyen-ny ${sha} ${file}`
fixture.cases = fixture.cases.map((c) => ({in: c.in, out: norskSlug(c.in)}))
writeFileSync(path, JSON.stringify(fixture, null, 1) + '\n')
console.log(`${fixture.cases.length} cases answered by ${fixture.answeredBy}`)
