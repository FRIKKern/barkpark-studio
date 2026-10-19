import {queryOptions} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset} from '../server/barkpark'
import {mergeSchedules, readPage, readSchedules, type Schedule} from './schedule-read'

// J40, Sanity's "Schedule publish": the draft publishes at a set time, run on the
// server as the editor who scheduled it (Barkpark /v1/data/schedules, task-8e88b5539acafdae).
// A Barkpark without the route answers 404: then `supported` is false and the studio
// offers no Schedule action.

export type {Schedule} from './schedule-read'

const fetchSchedule = createServerFn({method: 'GET'})
  .validator((d: {id: string; type: string}) => d)
  .handler(async ({data}) => {
    const res = await bpFetch(`/v1/data/schedules/${dataset()}?id=${encodeURIComponent(data.id)}&type=${encodeURIComponent(data.type)}&status=all`)
    return readSchedules(res.status, res.ok ? await res.json() : null)
  })

export const scheduleQuery = (id: string, type: string) =>
  queryOptions({queryKey: ['schedule', id], staleTime: 10_000, queryFn: () => fetchSchedule({data: {id, type}})})

// The Releases tool's Scheduled drafts (Sanity's): every schedule in the dataset, any status.
// Barkpark's list answers 500 rows a page, so pending and paused are read apart (mergeSchedules),
// and each read keeps the latest 500 (order=desc, barkpark#23799; an older Barkpark ignores it).
// `more` is where the rest of `status=all` starts (barkpark#23803), for Archived's Load more;
// null on an older Barkpark, which does not page.
const fetchAllSchedules = createServerFn({method: 'GET'}).handler(async () => {
  const pages = await Promise.all(
    ['scheduled', 'paused', 'all'].map(async (status) => {
      const res = await bpFetch(`/v1/data/schedules/${dataset()}?status=${status}&order=desc`)
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`Could not read the schedules (${res.status})`)
      return readPage(await res.json())
    }),
  )
  if (pages.includes(null)) return {supported: false, schedules: [] as Schedule[], more: null}
  const [pending, paused, all] = pages as {schedules: Schedule[]; next: number | null}[]
  return {supported: true, schedules: mergeSchedules(pending.schedules, paused.schedules, all.schedules), more: all.next}
})

/** The next page of `status=all` (latest first), from `offset`: its rows and the page after it. */
export const fetchMoreSchedules = createServerFn({method: 'GET'})
  .validator((d: {offset: number}) => d)
  .handler(async ({data}) => {
    const res = await bpFetch(`/v1/data/schedules/${dataset()}?status=all&order=desc&offset=${Math.max(0, Math.floor(data.offset))}`)
    if (!res.ok) throw new Error(`Could not read the schedules (${res.status})`)
    return readPage(await res.json())
  })

export const schedulesQuery = queryOptions({queryKey: ['schedules'], staleTime: 0, queryFn: () => fetchAllSchedules()})

/** Why Barkpark refused, in its words (422 "publishAt must be in the future", 409 one is already set). */
async function refusal(res: Response, what: string) {
  const body = (await res.json().catch(() => null)) as {error?: {message?: string}} | null
  return new Error(body?.error?.message ?? `${what} (${res.status})`)
}

export const schedulePublish = createServerFn({method: 'POST'})
  .validator((d: {id: string; type: string; publishAt: string}) => d)
  .handler(async ({data}) => {
    const res = await bpFetch(`/v1/data/schedules/${dataset()}`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(data)})
    if (!res.ok) throw await refusal(res, 'Could not schedule the publish')
    return ((await res.json()) as {schedule: Schedule}).schedule
  })

export const cancelSchedule = createServerFn({method: 'POST'})
  .validator((d: {scheduleId: string}) => d)
  .handler(async ({data}) => {
    const res = await bpFetch(`/v1/data/schedules/${dataset()}/${encodeURIComponent(data.scheduleId)}`, {method: 'DELETE'})
    if (!res.ok) throw await refusal(res, 'Could not delete the schedule')
    return {ok: true}
  })

/**
 * Sanity's "Pause to edit": the schedule keeps its time and runs nothing until it is
 * resumed (barkpark#23198). A Barkpark without the route answers 404: `paused` is false
 * and the caller cancels the schedule instead, as before.
 */
export const pauseSchedule = createServerFn({method: 'POST'})
  .validator((d: {scheduleId: string}) => d)
  .handler(async ({data}) => {
    const res = await bpFetch(`/v1/data/schedules/${dataset()}/${encodeURIComponent(data.scheduleId)}/pause`, {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'})
    if (res.status === 404) return {paused: false}
    if (!res.ok) throw await refusal(res, 'Could not pause the schedule')
    return {paused: true}
  })

/** Schedule again after a pause: at its own time or a new future one. */
export const resumeSchedule = createServerFn({method: 'POST'})
  .validator((d: {scheduleId: string; publishAt: string}) => d)
  .handler(async ({data}) => {
    const res = await bpFetch(`/v1/data/schedules/${dataset()}/${encodeURIComponent(data.scheduleId)}/resume`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({publishAt: data.publishAt})})
    if (!res.ok) throw await refusal(res, 'Could not schedule the publish')
    return ((await res.json()) as {schedule: Schedule}).schedule
  })
