// Generate's slug is Sanity's: æøå transliterated, symbols spelled out, cut on a word.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {slugify} from './slug.ts'

test("slugs as Sanity's speakingurl makes them", async () => {
  assert.equal(await slugify('Blåbær på Ørsta'), 'blabaer-pa-orsta')
  assert.equal(await slugify('Ærlig talt'), 'aerlig-talt')
  assert.equal(await slugify('Smørbrød & kaffe'), 'smorbrod-and-kaffe')
  assert.equal(await slugify('Fixture post 03'), 'fixture-post-03')
  assert.equal(await slugify('Field types 01', 10), 'field')
  assert.equal(await slugify(''), '')
})
