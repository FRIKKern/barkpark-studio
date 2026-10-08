import {createServerFn} from '@tanstack/react-start'
import {queryOptions} from '@tanstack/react-query'
import {bpRoot, scope} from '../server/barkpark'
import type {Scope} from './scope'

// B02: where this page works (its URL's scope, else the studio's default) and where the
// switcher can take it: the workspaces, projects and datasets this editor's token reaches.

type Json = string | number | boolean | null | Json[] | {[k: string]: Json}
export type Option = {slug: string; name: string}
export type ScopeOptions = {workspaces: Option[]; projects: Option[]; datasets: Option[]}

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
    const [workspaces, projects, datasets] = await Promise.all([
      list('/api/workspaces', 'workspaces'),
      list(`/api/workspaces/${ws}/projects`, 'projects'),
      list(`/api/workspaces/${ws}/projects/${encodeURIComponent(data.project)}/datasets`, 'datasets'),
    ])
    return {workspaces, projects, datasets} as unknown as Json
  })
export const scopeOptionsQuery = (at: {workspace: string; project: string}) =>
  queryOptions({queryKey: ['scope-options', at.workspace, at.project], queryFn: async () => (await fetchOptions({data: at})) as unknown as ScopeOptions})
