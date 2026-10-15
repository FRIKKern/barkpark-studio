import {createServerFn} from '@tanstack/react-start'
import {queryOptions} from '@tanstack/react-query'
import {bpFetch, bpRoot, scope} from '../server/barkpark'
import {readSchemas} from '../server/schemas'
import {parsePanes, panesPath} from './panes'
import {parseScope, scopedPath, type Scope} from './scope'

// B02: where this page works (its URL's scope, else the studio's default) and where the
// switcher can take it: the workspaces, projects and datasets this editor's token reaches.

type Json = string | number | boolean | null | Json[] | {[k: string]: Json}
export type Option = {slug: string; name: string}
/** A list is missing when Barkpark refused it: that switcher stays on the current scope. */
export type ScopeOptions = {workspaces?: Option[]; projects?: Option[]; datasets?: Option[]}

const fetchCurrent = createServerFn({method: 'GET'}).handler(async () => scope() as unknown as Json)
export const currentScopeQuery = queryOptions({queryKey: ['scope'], queryFn: async () => (await fetchCurrent()) as unknown as Scope, staleTime: Infinity})

async function list(path: string, key: string): Promise<Option[]> {
  const res = await bpRoot(path)
  if (!res.ok) throw new Error(`Barkpark ${res.status} listing ${key}`)
  const rows = ((await res.json()) as Record<string, {slug: string; name?: string; archived_at?: string | null}[]>)[key] ?? []
  return rows.filter((r) => !r.archived_at).map((r) => ({slug: r.slug, name: r.name || r.slug}))
}

const fetchOptions = createServerFn({method: 'GET'})
  .validator((d: {workspace: string; project: string}) => d)
  .handler(async ({data}) => {
    const ws = encodeURIComponent(data.workspace)
    // Each list on its own: one Barkpark refuses (a member's session may not list
    // workspaces) leaves that switcher on the current scope, not all three disabled.
    const [workspaces, projects, datasets] = await Promise.allSettled([
      list('/api/workspaces', 'workspaces'),
      list(`/api/workspaces/${ws}/projects`, 'projects'),
      list(`/api/workspaces/${ws}/projects/${encodeURIComponent(data.project)}/datasets`, 'datasets'),
    ])
    const got = (r: PromiseSettledResult<Option[]>) => (r.status === 'fulfilled' ? r.value : (console.warn('[scope]', r.reason instanceof Error ? r.reason.message : r.reason), undefined))
    return {workspaces: got(workspaces), projects: got(projects), datasets: got(datasets)} as unknown as Json
  })
export const scopeOptionsQuery = (at: {workspace: string; project: string}) =>
  queryOptions({queryKey: ['scope-options', at.workspace, at.project], queryFn: async () => (await fetchOptions({data: at})) as unknown as ScopeOptions})

// Switching keeps the open panes (scout 2026-10-15; it always went to the tool's root):
// as many of them, from the left, as the target has too: each list's type in its schema,
// each document there (draft or published). The rest close; none kept, the root.
const SLUG = /^[a-z0-9][a-z0-9_-]*$/
const fetchKept = createServerFn({method: 'GET'})
  .validator((d: {at: Scope; panes: {type: string; id?: string}[]}) => {
    if (![d.at.workspace, d.at.project, d.at.dataset].every((x) => SLUG.test(x))) throw new Error('not a scope')
    return d
  })
  .handler(async ({data: {at, panes}}) => {
    const opts = {at, retry: false}
    const ds = encodeURIComponent(at.dataset)
    // Fixture schemas (CI after a schema change) are the same for every dataset.
    const types =
      process.env.BARKPARK_SCHEMA_SOURCE === 'fixtures'
        ? (await readSchemas()).map((s) => s.name)
        : await bpFetch(`/v1/schemas/${ds}`, {}, undefined, opts).then(async (r) => (r.ok ? ((await r.json()) as {schemas: {name: string}[]}).schemas.map((s) => s.name) : []), () => [])
    let kept = 0
    for (const p of panes) {
      if (!types.includes(p.type)) break
      if (p.id) {
        const res = await bpFetch(`/v1/data/doc/${ds}/${encodeURIComponent(p.type)}/${encodeURIComponent(p.id.replace(/^drafts\./, ''))}?perspective=drafts`, {}, undefined, opts).catch(() => undefined)
        if (!res?.ok) break
      }
      kept++
    }
    return kept
  })

/** Where a switch to `to` lands from `here` (a pathname and its search): see fetchKept. */
export async function switchedPath(to: Scope, here: {pathname: string; search: string}): Promise<string> {
  const rest = parseScope(here.pathname).rest
  const tool = '/' + (rest.split('/')[1] || 'structure')
  const splat = /^\/structure\/(.+)$/.exec(rest)?.[1]
  if (!splat) return scopedPath(to, tool)
  const panes = parsePanes(decodeURIComponent(splat))
  // A desk menu has no type to look for: the panes stop before it.
  const asked: {type: string; id?: string}[] = []
  for (const p of panes.slice(1)) {
    if (p.kind === 'list') asked.push({type: p.type})
    else if (p.kind === 'doc') asked.push({type: p.type, id: p.id})
    else break
  }
  const kept = asked.length ? await fetchKept({data: {at: to, panes: asked}}).catch(() => 0) : 0
  const keep = panes.slice(0, 1 + kept)
  return scopedPath(to, panesPath(keep)) + (kept === panes.length - 1 ? here.search : '')
}

