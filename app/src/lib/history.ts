import {queryOptions} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset} from '../server/barkpark'
import type {Doc} from './data'

// Document history (J16), from Barkpark's snapshots: /v1/data/history lists the
// revisions (newest first), /v1/data/revision/:id is one snapshot, and its
// /restore writes that snapshot back as the draft — what Sanity's Restore does.
// Barkpark names who acted: actor_label is the acting token owner's email, read with
// any member token (task-d0c6a847e2a4658e, barkpark #22115).

export type {Revision} from './timeline'
export {actionLabel, timeline, type HistoryEntry} from './timeline'
import type {Revision} from './timeline'
type RawRevision = {id: string; action: string; status: 'draft' | 'published'; timestamp: string; title?: string; actor_id?: string; actor_label?: string | null}

type Json = string | number | boolean | null | Json[] | {[k: string]: Json}

const fetchHistory = createServerFn({method: 'GET'})
  .validator((d: {type: string; id: string}) => d)
  .handler(async ({data}) => {
    const res = await bpFetch(`/v1/data/history/${dataset()}/${encodeURIComponent(data.type)}/${encodeURIComponent(data.id)}?limit=100`)
    if (!res.ok) throw new Error(`history ${res.status}`)
    const {revisions} = (await res.json()) as {revisions: RawRevision[]}
    return revisions.map((r) => ({
      id: r.id,
      action: r.action,
      status: r.status,
      timestamp: r.timestamp,
      title: r.title,
      actorId: r.actor_id,
      author: r.actor_label || 'API token', // a row with no owner (a service token)
    })) as unknown as Json
  })

const fetchRevision = createServerFn({method: 'GET'})
  .validator((d: {id: string}) => d)
  .handler(async ({data}) => {
    const res = await bpFetch(`/v1/data/revision/${dataset()}/${encodeURIComponent(data.id)}`)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`revision ${res.status}`)
    // Barkpark keeps `title` as a row column: it rides beside the snapshot, not in it.
    const {revision} = (await res.json()) as {revision: {title?: string; content: Record<string, Json>}}
    return {...revision, content: {...revision.content, ...(revision.title !== undefined && {title: revision.title})}} as unknown as Json
  })

export const restoreRevision = createServerFn({method: 'POST'})
  .validator((d: {id: string; type: string}) => d)
  .handler(async ({data}) => {
    const res = await bpFetch(`/v1/data/revision/${dataset()}/${encodeURIComponent(data.id)}/restore?type=${encodeURIComponent(data.type)}`, {method: 'POST'})
    if (!res.ok) throw new Error(`restore ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return ((await res.json()) as {document: Json}).document
  })

/**
 * D22: who wrote the revision `rev` of a document, from its history (null when
 * Barkpark has no row for it: a Bulldocs paper's ops write none, task-1ecebe46ef50e427).
 */
export const editedBy = createServerFn({method: 'GET'})
  .validator((d: {type: string; id: string; rev: string}) => d)
  .handler(async ({data}) => {
    const res = await bpFetch(`/v1/data/history/${dataset()}/${encodeURIComponent(data.type)}/${encodeURIComponent(data.id)}?limit=10`)
    if (!res.ok) return null
    const {revisions} = (await res.json()) as {revisions: (RawRevision & {rev?: string})[]}
    const row = revisions.find((r) => r.rev === data.rev)
    return row ? row.actor_label || 'API token' : null
  })

export const historyQuery = (type: string, id: string) =>
  queryOptions({queryKey: ['history', id], staleTime: 5_000, queryFn: async () => (await fetchHistory({data: {type, id}})) as unknown as Revision[]})

export type RevisionDoc = {id: string; timestamp: string; action: string; content: Record<string, unknown>}
export const revisionQuery = (id: string) =>
  queryOptions({queryKey: ['revision', id], staleTime: Infinity, queryFn: async () => (await fetchRevision({data: {id}})) as unknown as RevisionDoc | null})

export type {Doc}
