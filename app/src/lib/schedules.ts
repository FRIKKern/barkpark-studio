import {queryOptions} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset} from '../server/barkpark'

// J40, Sanity's "Schedule publish": the draft publishes at a set time, run on the
// server as the editor who scheduled it (Barkpark /v1/data/schedules, task-8e88b5539acafdae).
// A Barkpark without the route answers 404: then `supported` is false and the studio
// offers no Schedule action.

export type Schedule = {_id: string; documentId: string; type: string; publishAt: string; status: string; reason?: string | null}

const fetchSchedule = createServerFn({method: 'GET'})
  .validator((d: {id: string; type: string}) => d)
  .handler(async ({data}) => {
    const res = await bpFetch(`/v1/data/schedules/${dataset()}?id=${encodeURIComponent(data.id)}&type=${encodeURIComponent(data.type)}`)
    if (res.status === 404) return {supported: false, schedule: null}
    if (!res.ok) throw new Error(`Could not read the schedule (${res.status})`)
    const {schedules} = ((await res.json()) as {result: {schedules: Schedule[]}}).result
    return {supported: true, schedule: schedules.find((s) => s.status === 'scheduled') ?? null}
  })

export const scheduleQuery = (id: string, type: string) =>
  queryOptions({queryKey: ['schedule', id], staleTime: 10_000, queryFn: () => fetchSchedule({data: {id, type}})})

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
