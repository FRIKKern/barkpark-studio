// Generate's slug is Sanity's: æøå transliterated, symbols spelled out, cut on a word.
// A field's options.slugify "nb" is HSO's norskSlug instead (./slugify.ts).
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import {slugify} from './slug.ts'
import {withOptionIconBodies} from './desk-icon-bodies.ts'

test("slugs as Sanity's speakingurl makes them", async () => {
  assert.equal(await slugify('Blåbær på Ørsta'), 'blabaer-pa-orsta')
  assert.equal(await slugify('Ærlig talt'), 'aerlig-talt')
  assert.equal(await slugify('Smørbrød & kaffe'), 'smorbrod-and-kaffe')
  assert.equal(await slugify('Fixture post 03'), 'fixture-post-03')
  assert.equal(await slugify('Field types 01', 10), 'field')
  assert.equal(await slugify(''), '')
  // The rows where "nb" parts from it (docs/EXTENDING.md).
  assert.equal(await slugify('Steen & Strøm', 96), 'steen-and-strom')
  assert.equal(await slugify('Grünerløkka', 96), 'gruenerlokka')
  assert.equal(await slugify('Straße', 96), 'strasse')
  assert.equal(await slugify('£100 i måneden', 96), 'gbp100-i-maneden')
})

type Cases = {answeredBy: string; maxLength: number; cases: {in: string; out: string}[]}
const nb = JSON.parse(readFileSync(new URL('../../../fixtures/slugify-nb-cases.json', import.meta.url), 'utf8')) as Cases

test(`options.slugify "nb" answers as HSO's norskSlug (fixtures/slugify-nb-cases.json, ${nb.answeredBy})`, async () => {
  assert.ok(nb.cases.length >= 17 && nb.cases.every((c) => typeof c.out === 'string'))
  for (const c of nb.cases) assert.equal(await slugify(c.in, nb.maxLength, 'nb'), c.out, c.in)
})

test('"nb" applies the field\'s own maxLength, then drops a hyphen left at the end', async () => {
  assert.equal(await slugify('Kafé på Ensjø åpent', 12, 'nb'), 'kafe-pa-ensj')
  assert.equal(await slugify('Kafé på Ensjø', 8, 'nb'), 'kafe-pa')
  assert.equal(await slugify('', 96, 'nb'), '')
})

test('no table, or one the studio does not know, is the default slug, said once in the console', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {})
  assert.equal(await slugify('Steen & Strøm', 200), 'steen-and-strom')
  assert.equal(await slugify('Steen & Strøm', 200, null), 'steen-and-strom')
  assert.equal(warn.mock.callCount(), 0)
  for (const table of ['xx', 'constructor', 7, {nb: true}, 'xx', 7]) assert.equal(await slugify('Steen & Strøm', 200, table), 'steen-and-strom')
  assert.deepEqual(warn.mock.calls.map((c) => String(c.arguments[0]).split(' ')[1]), ['xx', 'constructor', '7', '{"nb":true}'])
})

test('the slug field hands its options.slugify to Generate (components/Fields.tsx)', () => {
  const fields = readFileSync(new URL('../components/Fields.tsx', import.meta.url), 'utf8').replace(/\s+/g, ' ')
  assert.ok(fields.includes('table={(field.options as {slugify?: unknown})?.slugify}'), 'SlugInput gets the field\'s table')
  assert.ok(fields.includes('slugify(from, maxLength, table)'), 'Generate slugs with it')
})

test('the studio reads options.slugify as Barkpark holds it (fieldIcons keeps the options)', () => {
  const fields = [{name: 'slug', type: 'slug', options: {source: 'tittel', slugify: 'nb', maxLength: 96}}]
  assert.deepEqual(withOptionIconBodies(fields, {}), fields)
})
