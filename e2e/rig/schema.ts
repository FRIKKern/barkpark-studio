import {readFileSync} from 'node:fs'
import {bpBase, bpDataset} from './targets'

// A test for a field or option the CI pool's datasets don't have until someone reseeds them
// (--schemas) skips. Asked here, before its page loads, it skips in one Barkpark read: asked of
// the loaded page, each cost CI a page load (1-2 s; task-c1df532bed870536). The page's own check
// stays after the load. Read where the studio reads it (app/src/server/schemas.ts): the
// checkout's fixtures when the run says so (CI, on a PR that changes them), else Barkpark.
type Schema = {name: string; fields?: {name: string}[]; desk?: Record<string, unknown>}

const schemas = new Map<string, Promise<Schema | undefined>>()

/** `type`'s schema as this run's studio reads it; undefined when the dataset has none. */
export function studioSchema(type: string): Promise<Schema | undefined> {
  if (!schemas.has(type)) schemas.set(type, readSchema(type))
  return schemas.get(type)!
}

async function readSchema(type: string): Promise<Schema | undefined> {
  if (process.env.BARKPARK_SCHEMA_SOURCE === 'fixtures') return JSON.parse(readFileSync(new URL(`../../fixtures/barkpark-schema/${type}.json`, import.meta.url), 'utf8')) as Schema
  const r = await fetch(`${bpBase()}/v1/schemas/${bpDataset()}`, {headers: {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}})
  // Not read: say yes, and the page's own check decides (as before).
  if (!r.ok) return {name: type, fields: undefined}
  return ((await r.json()) as {schemas: Schema[]}).schemas.find((s) => s.name === type)
}

/** Whether `type`'s schema has the top-level field `field` (yes when it could not be read). */
export async function schemaHasField(type: string, field: string) {
  const schema = await studioSchema(type)
  return !!schema && (!schema.fields || schema.fields.some((f) => f.name === field))
}

/** Whether `type`'s schema declares the desk option `option` (yes when it could not be read). */
export async function schemaHasDesk(type: string, option: string) {
  const schema = await studioSchema(type)
  return !!schema && (!schema.fields || schema.desk?.[option] !== undefined)
}
