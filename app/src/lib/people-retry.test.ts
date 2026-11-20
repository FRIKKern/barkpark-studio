// task-323588e08062e79c: a studio token without a members seat gets 403 on the people roster
// (lib/people.ts). That is an answer, not an outage: no retries, so no "Trying to connect…".
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {rosterRetry} from './dashboard.ts'
import {struggling} from './struggling.ts'

// React Query retries only in a browser (it checks for a window when it loads).
;(globalThis as {window?: unknown}).window = globalThis
const {QueryClient} = await import('@tanstack/react-query')

/** Read the roster once, failing with `status`: how often it was asked, and whether the toast would count it. */
async function roster(status: number) {
  // 'always': node has no navigator.onLine, so React Query would wait for a network forever.
  const qc = new QueryClient({defaultOptions: {queries: {networkMode: 'always'}}})
  let asked = 0
  let toast = false
  qc.getQueryCache().subscribe(({query}) => (toast ||= struggling(query)))
  await qc
    .fetchQuery({
      queryKey: ['people'],
      queryFn: async () => (asked++, Promise.reject(new Error(`Could not load the users (${status})`))),
      retry: rosterRetry,
      retryDelay: 0,
    })
    .catch(() => {})
  qc.clear()
  return {asked, toast}
}

test('a 403 on people is not retried and does not toast', async () => {
  assert.deepEqual(await roster(403), {asked: 1, toast: false})
  assert.deepEqual(await roster(401), {asked: 1, toast: false})
})

test('a 500 on people is still retried, and the toast counts it', async () => {
  assert.deepEqual(await roster(500), {asked: 4, toast: true})
})
