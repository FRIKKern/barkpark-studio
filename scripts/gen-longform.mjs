#!/usr/bin/env node
// J44's very long document, written into the fixtures: the Barkpark schema
// (fixtures/barkpark-schema/longform.json) and its one doc (longform-1 in
// fixtures/seed.ndjson). 200 fields + a 300-item object array. The Sanity side
// builds the same shape in reference/sanity/schemaTypes/longform.ts; keep the
// two in step. Re-run after changing the shape, then seed twice.
//
//   node scripts/gen-longform.mjs
import {readFileSync, writeFileSync} from 'node:fs'

const root = new URL('..', import.meta.url)
const FIELDS = 200
const ROWS = 300
const pad = (i) => String(i).padStart(3, '0')
// Field i (2..200) cycles through the plain inputs; field 1 is the title.
const KINDS = ['string', 'text', 'number', 'boolean', 'string']
const kind = (i) => KINDS[i % KINDS.length]
const value = (i) => ({string: `Value ${pad(i)}`, text: `Longer text for field ${pad(i)}.`, number: i, boolean: i % 2 === 0})[kind(i)]

const fields = [{name: 'title', title: 'Title', type: 'string'}]
for (let i = 2; i <= FIELDS; i++) fields.push({name: `f${pad(i)}`, title: `Field ${pad(i)}`, type: kind(i), ...(kind(i) === 'text' ? {rows: 2} : {})})
fields.push({
  name: 'rows',
  title: 'Rows',
  type: 'arrayOf',
  ordered: true,
  of: {type: 'composite', preview: {title: 'title', subtitle: 'note'}, fields: [{name: 'title', title: 'Title', type: 'string'}, {name: 'note', title: 'Note', type: 'string'}]},
})
const schema = {name: 'longform', title: 'Longform', visibility: 'public', fields}
writeFileSync(new URL('fixtures/barkpark-schema/longform.json', root), JSON.stringify(schema, null, 2) + '\n')

const doc = {_id: 'longform-1', _type: 'longform', title: 'Very long document'}
for (let i = 2; i <= FIELDS; i++) doc[`f${pad(i)}`] = value(i)
doc.rows = Array.from({length: ROWS}, (_, i) => ({_key: `row${pad(i + 1)}`, _type: 'row', title: `Row ${pad(i + 1)}`, note: `Note ${pad(i + 1)}`}))
const seed = new URL('fixtures/seed.ndjson', root)
const lines = readFileSync(seed, 'utf8').trimEnd().split('\n').filter((l) => !l.includes('"_id": "longform-1"') && !l.includes('"_id":"longform-1"'))
writeFileSync(seed, [...lines, JSON.stringify(doc)].join('\n') + '\n')
console.log(`longform: ${fields.length - 1} fields + ${ROWS} rows`)
