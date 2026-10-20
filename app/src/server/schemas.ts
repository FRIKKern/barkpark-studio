// Where the studio gets its content model. Default: the Barkpark API (a member token
// may read it, barkpark #22080). BARKPARK_SCHEMA_SOURCE=fixtures reads the checked-in
// fixtures/barkpark-schema/ instead: CI does that for a PR that changes them.
import '@tanstack/react-start/server-only'
import {readdir, readFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {bpFetch, dataset, contentModelToken, serviceToken} from './barkpark'
import {signInMode, signOut} from './auth'
import {ACCOUNT_SESSION_LOST} from '../lib/content-model-credential'

async function readContentModel(path: string) {
  const response = await bpFetch(path, {}, await contentModelToken())
  if (response.status === 401 && signInMode() === 'account') {
    await signOut()
    throw new Error(ACCOUNT_SESSION_LOST)
  }
  return response
}

export type RawSchema = {name: string; title: string; fields: unknown[]; listPreview?: unknown; list_preview?: unknown; groups?: unknown; fieldsets?: unknown; initialValues?: unknown; initial_values?: unknown; desk?: unknown; singleton?: unknown; layout?: unknown; prefill?: unknown; kind?: unknown}

/**
 * The studio's own record types (lib/tasks.ts, lib/comments.ts): declared in each
 * dataset so Barkpark knows them, never content. Kept out of the desk, lists, new
 * documents and search, as Sanity keeps its own task and comment types.
 */
export const STUDIO_TYPES = ['studioTask', 'studioComment', 'studioVisionQuery']

export async function readSchemas(): Promise<RawSchema[]> {
  return (await readAllSchemas()).filter((s) => !STUDIO_TYPES.includes(s.name))
}

/** The studio comment type's schema as the dataset holds it (J49: does it let viewers comment?). */
export async function readCommentSchema(): Promise<RawSchema | undefined> {
  return (await readAllSchemas()).find((s) => s.name === 'studioComment')
}

async function readAllSchemas(): Promise<RawSchema[]> {
  if (process.env.BARKPARK_SCHEMA_SOURCE === 'fixtures') {
    const dir = resolve(process.cwd(), '../fixtures/barkpark-schema')
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json'))
    return Promise.all(files.map(async (f) => asBarkparkServes(JSON.parse(await readFile(join(dir, f), 'utf8')) as RawSchema)))
  }
  const res = await readContentModel(`/v1/schemas/${dataset()}`)
  if (!res.ok) throw new Error(`Barkpark /v1/schemas/${dataset()} → ${res.status}`)
  return ((await res.json()) as {schemas: RawSchema[]}).schemas
}

/**
 * A fixture file in the shape Barkpark's /v1/schemas answers: it spells `list_preview` and
 * `initial_values` as written, and serves them as `listPreview` and `initialValues`. Server
 * code reads the served names (the reference search's preview hits read `listPreview`), so a
 * PR that changed the fixtures, and so read them from the checkout, lost "lovelace" finding
 * Ada's posts (J08 on studio #824).
 */
function asBarkparkServes({list_preview, initial_values, ...schema}: RawSchema): RawSchema {
  return {...schema, ...(list_preview !== undefined && {listPreview: list_preview}), ...(initial_values !== undefined && {initialValues: initial_values})}
}

// B12: the declared desk, when the workspace has one. Barkpark resolves a
// `deskStructure` document into its structure tree; without that document the
// tree is the LiveView Studio's default, not Sanity's type list, so this studio
// keeps its own type list then (null). Other failures use the route's visible
// error and Retry; an unavailable desk must not silently change navigation.
// Fixtures mode (CI) has no desk.
export async function readDesk(): Promise<unknown | null> {
  if (process.env.BARKPARK_SCHEMA_SOURCE === 'fixtures') return null
  const declared = await readContentModel(`/v1/data/doc/${dataset()}/deskStructure/deskStructure?perspective=published`)
  if (declared.status === 404) return null
  if (!declared.ok) throw new Error(`Could not read the desk configuration (${declared.status})`)
  const title = ((await declared.json()) as {result?: {title?: unknown}}).result?.title
  const res = await bpFetch(`/v1/structure/${dataset()}`, {}, await serviceToken())
  if (!res.ok) throw new Error(`Could not read the desk navigation (${res.status})`)
  const tree = ((await res.json()) as {structure?: {title?: string}}).structure
  if (!tree) throw new Error('The desk navigation response was empty')
  // The deskStructure document's title names the root (Sanity's S.list().title('Innhold')).
  // Barkpark keeps a doc's title in a row column while its resolver reads content.title,
  // so the tree answers "Structure" (task-b40b41f8d21992ae); the declared title wins here.
  return typeof title === 'string' && title.trim() ? {...tree, title: title.trim()} : tree
}

/**
 * Barkpark's "…Rest": the doc types in this dataset that no desk row places (its own
 * tree's last group), so no type is silently out of reach. A type with a schema opens
 * as a list; one without (orphaned) is a count only, as in LiveView. Never fatal: a
 * failed read just leaves the group out.
 */
export async function readRest(): Promise<unknown[]> {
  if (process.env.BARKPARK_SCHEMA_SOURCE === 'fixtures') return []
  const res = await serviceToken().then((token) => bpFetch(`/v1/structure/${dataset()}`, {}, token)).catch(() => null)
  if (!res?.ok) return []
  const tree = ((await res.json()) as {structure?: {items?: {id?: string; items?: unknown[]}[]}}).structure
  const rest = (tree?.items?.find((i) => i.id === 'rest')?.items ?? []) as {typeName?: string}[]
  // The studio's own records are never "…Rest" content, even in a dataset whose schema list lacks them.
  return rest.filter((i) => !STUDIO_TYPES.includes(i.typeName ?? ''))
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
