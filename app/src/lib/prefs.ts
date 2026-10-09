import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset} from '../server/barkpark'

// Per-editor settings on Barkpark, as Sanity keeps them per user on its server
// (task-7d2a48dbf7e4bf34, barkpark #22202): GET / PUT /v1/prefs/:dataset/:key, keyed
// by the acting token's owner, so they follow the editor to another browser or device.
// A token with no owner, or Barkpark out of reach, answers null / false: callers keep
// their copy in this browser then.

/** Read one pref on the server (null when there is none, or none can be read). */
async function readPref(key: string): Promise<unknown> {
  const res = await bpFetch(`/v1/prefs/${dataset()}/${encodeURIComponent(key)}`, {}, undefined, {retry: false}).catch(() => undefined)
  if (!res?.ok) return null
  return ((await res.json()) as {value?: unknown}).value ?? null
}

export const getPref = createServerFn({method: 'GET'})
  .validator((key: string) => key)
  .handler(async ({data}) => (await readPref(data)) as never)

export const putPref = createServerFn({method: 'POST'})
  .validator((d: {key: string; value: unknown}) => d)
  .handler(async ({data}) => {
    const res = await bpFetch(`/v1/prefs/${dataset()}/${encodeURIComponent(data.key)}`, {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify({value: data.value})}, undefined, {retry: false}).catch(() => undefined)
    return !!res?.ok
  })
