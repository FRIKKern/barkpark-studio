// Generate's slug is Sanity's: æøå transliterated, symbols spelled out, cut on a word.
import assert from 'node:assert/strict'
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
})

test('options.slugify "nb" is HSO\'s norskSlug: æøå, then one hyphen for anything else (task-15e2e504dd3c74cc)', async () => {
  assert.equal(await slugify('Bærekraft på Økern', 96, 'nb'), 'baerekraft-pa-okern')
  // Where it differs from the default: & is no "and", ü is u, ß and £ go.
  assert.equal(await slugify('Steen & Strøm', 96, 'nb'), 'steen-strom')
  assert.equal(await slugify('NF&TA', 96, 'nb'), 'nf-ta')
  assert.equal(await slugify('Café Ü-ß £5', 96, 'nb'), 'cafe-u-5')
  // Cut at maxLength, no hyphen left at the end.
  assert.equal(await slugify('Kafé på Ensjø åpent', 12, 'nb'), 'kafe-pa-ensj')
  assert.equal(await slugify('Kafé på Ensjø', 8, 'nb'), 'kafe-pa')
  assert.equal(await slugify('', 96, 'nb'), '')
})

test('no table, or one the studio does not know, is the default slug', async () => {
  for (const table of [undefined, 'xx', 'constructor', 7, {nb: true}]) assert.equal(await slugify('Steen & Strøm', 200, table), 'steen-and-strom')
})

test('the studio reads options.slugify as Barkpark holds it (fieldIcons keeps the options)', () => {
  const fields = [{name: 'slug', type: 'slug', options: {source: 'tittel', slugify: 'nb', maxLength: 96}}]
  assert.deepEqual(withOptionIconBodies(fields, {}), fields)
})
