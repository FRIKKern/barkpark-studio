// Where the studio gets its content model. Default: the Barkpark API (a member token
// may read it, barkpark #22080). BARKPARK_SCHEMA_SOURCE=fixtures reads the checked-in
// fixtures/barkpark-schema/ instead: CI does that for a PR that changes them.
import '@tanstack/react-start/server-only'
import {readdir, readFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {bpFetch, dataset, serviceToken} from './barkpark'

type RawSchema = {name: string; title: string; fields: unknown[]; listPreview?: unknown; list_preview?: unknown; groups?: unknown; initialValues?: unknown; initial_values?: unknown; desk?: unknown; singleton?: unknown; layout?: unknown; prefill?: unknown}

export async function readSchemas(): Promise<RawSchema[]> {
  if (process.env.BARKPARK_SCHEMA_SOURCE === 'fixtures') {
    const dir = resolve(process.cwd(), '../fixtures/barkpark-schema')
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json'))
    return Promise.all(files.map(async (f) => JSON.parse(await readFile(join(dir, f), 'utf8')) as RawSchema))
  }
  const res = await bpFetch(`/v1/schemas/${dataset()}`, {}, serviceToken())
  if (!res.ok) throw new Error(`Barkpark /v1/schemas/${dataset()} → ${res.status}`)
  return ((await res.json()) as {schemas: RawSchema[]}).schemas
}

// B12: the declared desk, when the workspace has one. Barkpark resolves a
// `deskStructure` document into its structure tree; without that document the
// tree is the LiveView Studio's default, not Sanity's type list, so this studio
// keeps its own type list then (null). Other failures use the route's visible
// error and Retry; an unavailable desk must not silently change navigation.
// Fixtures mode (CI) has no desk.
export async function readDesk(): Promise<unknown | null> {
  if (process.env.BARKPARK_SCHEMA_SOURCE === 'fixtures') return null
  const declared = await bpFetch(`/v1/data/doc/${dataset()}/deskStructure/deskStructure?perspective=published`, {}, serviceToken())
  if (declared.status === 404) return null
  if (!declared.ok) throw new Error(`Could not read the desk configuration (${declared.status})`)
  const title = ((await declared.json()) as {result?: {title?: unknown}}).result?.title
  const res = await bpFetch(`/v1/structure/${dataset()}`, {}, serviceToken())
  if (!res.ok) throw new Error(`Could not read the desk navigation (${res.status})`)
  const tree = ((await res.json()) as {structure?: {title?: string}}).structure
  if (!tree) throw new Error('The desk navigation response was empty')
  // The deskStructure document's title names the root (Sanity's S.list().title('Innhold')).
  // Barkpark keeps a doc's title in a row column while its resolver reads content.title,
  // so the tree answers "Structure" (task-b40b41f8d21992ae); the declared title wins here.
  return typeof title === 'string' && title.trim() ? {...tree, title: title.trim()} : tree
}

/**
 * The content model as one short string (each type's name and Barkpark's schemaHash):
 * when it differs from what a tab loaded, a schema was changed under it (lib/version.ts).
 */
export async function schemaFingerprint(): Promise<string> {
  if (process.env.BARKPARK_SCHEMA_SOURCE === 'fixtures') return 'fixtures'
  const schemas = (await readSchemas()) as (RawSchema & {schemaHash?: string})[]
  return schemas
    .map((s) => `${s.name}:${s.schemaHash ?? JSON.stringify(s.fields).length}`)
    .sort()
    .join(',')
}
