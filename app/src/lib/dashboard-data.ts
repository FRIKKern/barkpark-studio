import {queryOptions} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset} from '../server/barkpark'
import {readSchemas} from '../server/schemas'
import type {Doc} from './data'
import {docRows, draftsToCheck, LIMIT_MAX, orderExpr, upcoming, type RawDoc, type RowsKind} from './dashboard'
import {readPage, type Schedule} from './schedule-read'
import {groqPath} from './vision-groq'

// The Dashboard's reads (components/Dashboard.tsx). Opening it costs a bounded number of
// Barkpark reads, whatever the content model's size:
//   Unpublished changes  1 + 1 when there are drafts (their published versions)
//   Recently edited      1 + 1 when a draft is among them
//   Scheduled            1 + 1 when something is scheduled (the documents)
//   a document list      1 + 1, as Recently edited
//   My tasks             1 (the Tasks sidebar's own read, shared with it)
//   Members              1 per 200 members (the people pickers' read, kept 5 minutes)
// so at most 8 for the default five, plus the rows' previewed references in one batch per
// widget (lib/prime.ts). One read per type was the other way: 64 for a 64-type model, on a
// token that reads 300 a minute. After that the page listens (lib/live.ts): a frame is put
// into the rows with no read (lib/dashboard.ts withFrame), and nothing polls.

type Json = string | number | boolean | null | Json[] | {[k: string]: Json}

const API_VERSION = 'v2025-02-19'

/** One GROQ read over both versions of every document (the raw perspective), with the editor's own token. */
async function groq<T>(query: string, params: Record<string, unknown>): Promise<T> {
  const res = await bpFetch(groqPath(dataset(), API_VERSION, query, params, 'raw'))
  if (!res.ok) throw new Error(`Could not read the documents (${res.status})`)
  return ((await res.json()) as {result: T}).result
}

/** When the published versions of these drafts last changed, by id: one read for the lot. */
async function publishedAt(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {}
  const rows = await groq<{_id: string; _updatedAt: string}[]>('*[_id in $ids]{_id, _updatedAt}', {ids})
  return Object.fromEntries(rows.map((d) => [d._id, d._updatedAt]))
}

const fetchRows = createServerFn({method: 'GET'})
  .validator((d: {only: 'drafts' | 'all'; types: string[] | null; order: string; limit: number}) => d)
  .handler(async ({data}) => {
    // The desk's own document types only: never the studio's records (tasks, comments), whatever the page asks.
    const known = (await readSchemas()).filter((s) => s.kind !== 'object').map((s) => s.name)
    const types = data.types ? data.types.filter((t) => known.includes(t)) : known
    if (!types.length) return [] as Json
    const limit = Math.max(1, Math.min(LIMIT_MAX, Math.floor(data.limit) || 1))
    // Both versions of a document may be in the window: twice the rows, as Sanity's widget asks.
    const window = data.only === 'drafts' ? limit : limit * 2
    const filter = data.only === 'drafts' ? '_id in path("drafts.**") && _type in $types' : '_type in $types'
    const raw = await groq<RawDoc[]>(`*[${filter}] | order(${orderExpr(data.order)})[0...${window}]`, {types})
    return docRows(raw, await publishedAt(draftsToCheck(raw)), limit) as unknown as Json
  })

/** A widget's document rows. The key starts ['dashboard', 'rows']: the page's frame listener finds every one. */
export const rowsQuery = (kind: RowsKind) =>
  queryOptions({
    queryKey: ['dashboard', 'rows', kind.only, kind.types, kind.order, kind.limit],
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
    queryFn: async () => (await fetchRows({data: kind})) as unknown as Doc[],
  })

export type Upcoming = {supported: boolean; total: number; rows: {schedule: Schedule; doc: Doc | null}[]}

const fetchUpcoming = createServerFn({method: 'GET'})
  .validator((d: {limit: number}) => d)
  .handler(async ({data}) => {
    const res = await bpFetch(`/v1/data/schedules/${dataset()}?status=scheduled&order=desc`)
    // A Barkpark without schedules (lib/schedules.ts): the widget says so.
    if (res.status === 404) return {supported: false, total: 0, rows: []} as unknown as Json
    if (!res.ok) throw new Error(`Could not read the schedules (${res.status})`)
    const {rows, total} = upcoming(readPage(await res.json()).schedules, Math.max(1, Math.min(LIMIT_MAX, Math.floor(data.limit) || 1)))
    const ids = [...new Set(rows.map((s) => s.documentId.replace(/^drafts\./, '')))]
    const raw = ids.length ? await groq<RawDoc[]>('*[_id in $ids]', {ids: ids.flatMap((id) => [id, `drafts.${id}`])}) : []
    const docs = new Map(docRows(raw, {}, raw.length).map((d) => [d._publishedId, d]))
    return {supported: true, total, rows: rows.map((schedule) => ({schedule, doc: docs.get(schedule.documentId.replace(/^drafts\./, '')) ?? null}))} as unknown as Json
  })

/** The next scheduled publishes, each with its document. */
export const upcomingQuery = (limit: number) =>
  queryOptions({
    queryKey: ['dashboard', 'scheduled', limit],
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
    queryFn: async () => (await fetchUpcoming({data: {limit}})) as unknown as Upcoming,
  })
