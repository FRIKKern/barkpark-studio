import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync, readdirSync} from 'node:fs'
import {FIELD_TYPES, fixtureJsonSchema} from './schema-vocab.ts'
import {checkJsonSchema} from '../../../scripts/lib/json-schema-check.mjs'

// task-5012fe19eb89a5c6: the JSON Schema for fixtures/barkpark-schema can't drift from
// the studio. It is regenerated identically, every fixture passes it, a typo fails it,
// and the form's field registry draws exactly the types it lists.
const root = new URL('../../../', import.meta.url)
const generated = fixtureJsonSchema()

const check = (schema: Record<string, unknown>, value: unknown) => checkJsonSchema(schema, value)

test('the committed JSON Schema is what schema-vocab generates (run scripts/fixture-schema.mjs)', () => {
  assert.deepEqual(JSON.parse(readFileSync(new URL('fixtures/barkpark-schema.schema.json', root), 'utf8')), generated)
})

test('every fixture schema passes it', () => {
  const dir = new URL('fixtures/barkpark-schema/', root)
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) assert.deepEqual(check(generated, JSON.parse(readFileSync(new URL(f, dir), 'utf8'))), [], f)
})

test('it flags a typo: an unknown key, an unknown type, a bad rule', () => {
  const bad = {name: 'x', fields: [{name: 'a', type: 'strng'}, {name: 'b', type: 'string', requird: true}, {name: 'c', type: 'number', validation: {min: '1', level: 'fatal'}}, {name: 'd', type: 'string', validation: [{pattern: '('}]}]}
  assert.deepEqual(check(generated, bad), [
    '$.fields[0].type: "strng" is not one of the allowed values',
    '$.fields[1]: unknown key requird',
    '$.fields[2].validation: matches none of anyOf',
    '$.fields[3].validation: matches none of anyOf',
  ])
})

test('the form draws exactly the listed field types', () => {
  const fields = readFileSync(new URL('app/src/components/Fields.tsx', root), 'utf8')
  const drawn = [...new Set([...fields.matchAll(/case '([A-Za-z]+)':/g)].map((m) => m[1]))].sort()
  assert.deepEqual(drawn, [...FIELD_TYPES].sort())
})
