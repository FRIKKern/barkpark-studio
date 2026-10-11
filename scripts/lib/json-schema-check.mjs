// The JSON Schema subset fixtures/barkpark-schema.schema.json uses (draft-07: $ref, anyOf,
// enum, type, required, properties, additionalProperties: false, items): one problem per
// line, `$.fields[2]: unknown key requird`. Shared by seed-barkpark.mjs, which refuses a
// fixture that fails it (Barkpark ignores a misspelled key, task-415c5c02fad8a3c7), and
// app/src/lib/schema-vocab.test.ts.
export function checkJsonSchema(schema, value, at = '$', defs = schema.definitions ?? {}) {
  if (schema.$ref) return checkJsonSchema(defs[schema.$ref.split('/').pop()], value, at, defs)
  if (schema.anyOf) return schema.anyOf.some((s) => !checkJsonSchema(s, value, at, defs).length) ? [] : [`${at}: matches none of anyOf`]
  if (schema.enum && !schema.enum.includes(value)) return [`${at}: ${JSON.stringify(value)} is not one of the allowed values`]
  const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value
  if (schema.type && actual !== schema.type) return [`${at}: expected ${schema.type}, got ${actual}`]
  const out = []
  if (schema.type === 'array' && schema.items) value.forEach((v, i) => out.push(...checkJsonSchema(schema.items, v, `${at}[${i}]`, defs)))
  if (schema.type === 'object') {
    const props = schema.properties ?? {}
    for (const k of schema.required ?? []) if (!(k in value)) out.push(`${at}: missing ${k}`)
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) out.push(...checkJsonSchema(props[k], v, `${at}.${k}`, defs))
      else if (schema.additionalProperties === false) out.push(`${at}: unknown key ${k}`)
    }
  }
  if (schema.format === 'regex' && typeof value === 'string') {
    try {
      new RegExp(value)
    } catch {
      out.push(`${at}: not a valid regular expression`)
    }
  }
  return out
}
