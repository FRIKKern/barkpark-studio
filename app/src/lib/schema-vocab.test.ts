import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync, readdirSync} from 'node:fs'
import {FIELD_TYPES, fixtureJsonSchema} from './schema-vocab.ts'

// task-5012fe19eb89a5c6: the JSON Schema for fixtures/barkpark-schema can't drift from
// the studio. It is regenerated identically, every fixture passes it, a typo fails it,
// and the form's field registry draws exactly the types it lists.
const root = new URL('../../../', import.meta.url)
const generated = fixtureJsonSchema()

type S = Record<string, unknown>
/** The JSON Schema subset fixtureJsonSchema() uses; returns the problems. */
function check(schema: S, value: unknown, at = '$', defs = generated.definitions as Record<string, S>): string[] {
  if (schema.$ref) return check(defs[String(schema.$ref).split('/').pop()!]!, value, at, defs)
  if (schema.anyOf) return (schema.anyOf as S[]).some((s) => !check(s, value, at, defs).length) ? [] : [`${at}: matches none of anyOf`]
  if (schema.enum && !(schema.enum as unknown[]).includes(value)) return [`${at}: ${JSON.stringify(value)} is not one of the allowed values`]
  const type = schema.type as string | undefined
  const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value
  if (type && actual !== type) return [`${at}: expected ${type}, got ${actual}`]
  const out: string[] = []
  if (type === 'array' && schema.items) (value as unknown[]).forEach((v, i) => out.push(...check(schema.items as S, v, `${at}[${i}]`, defs)))
  if (type === 'object') {
    const v = value as S
    const props = (schema.properties ?? {}) as Record<string, S>
    for (const k of (schema.required ?? []) as string[]) if (!(k in v)) out.push(`${at}: missing ${k}`)
    for (const [k, val] of Object.entries(v)) {
      if (props[k]) out.push(...check(props[k]!, val, `${at}.${k}`, defs))
      else if (schema.additionalProperties === false) out.push(`${at}: unknown key ${k}`)
    }
  }
  return out
}

test('the committed JSON Schema is what schema-vocab generates (run scripts/fixture-schema.mjs)', () => {
  assert.deepEqual(JSON.parse(readFileSync(new URL('fixtures/barkpark-schema.schema.json', root), 'utf8')), generated)
})

test('every fixture schema passes it', () => {
  const dir = new URL('fixtures/barkpark-schema/', root)
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) assert.deepEqual(check(generated, JSON.parse(readFileSync(new URL(f, dir), 'utf8'))), [], f)
})

test('it flags a typo: an unknown key, an unknown type, a bad rule', () => {
  const bad = {name: 'x', fields: [{name: 'a', type: 'strng'}, {name: 'b', type: 'string', requird: true}, {name: 'c', type: 'number', validation: {min: '1', level: 'fatal'}}]}
  assert.deepEqual(check(generated, bad), [
    '$.fields[0].type: "strng" is not one of the allowed values',
    '$.fields[1]: unknown key requird',
    '$.fields[2].validation: matches none of anyOf',
  ])
})

test('the form draws exactly the listed field types', () => {
  const fields = readFileSync(new URL('app/src/components/Fields.tsx', root), 'utf8')
  const drawn = [...new Set([...fields.matchAll(/case '([A-Za-z]+)':/g)].map((m) => m[1]))].sort()
  assert.deepEqual(drawn, [...FIELD_TYPES].sort())
})
