// task-4ffed14fbf52dc47: the server, and the browser while it hydrates the server's page, draw the
// person as unknown even with an answer the session made in the cache; the same first frame on
// both sides, so a role-ruled page hydrates without a mismatch (React #418).
import assert from 'node:assert/strict'
import {register} from 'node:module'
import {test} from 'node:test'
import {createElement} from 'react'
import {renderToString} from 'react-dom/server'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'

register('./person-source.hooks.mjs', import.meta.url)
const {meQuery, madeBySession} = await import('./session.ts')
const {useCurrentUser} = await import('./person-source.ts')
const {keptEditsWait} = await import('./conditions.ts')

/** The person as a component draws it: whether it is still unknown (kept edits wait). */
function Who() {
  return createElement('i', null, keptEditsWait(useCurrentUser()) ? 'unknown' : 'known')
}

test("the server's snapshot (as a hydrating render reads it) is unknown, with an answer the session made in the cache", async () => {
  const g = globalThis as {window?: unknown}
  g.window = globalThis
  try {
    const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
    const me = await qc.fetchQuery(meQuery)
    assert.ok(madeBySession(me), 'the cached answer is the session’s own')
    assert.equal(renderToString(createElement(QueryClientProvider, {client: qc}, createElement(Who))), '<i>unknown</i>')
  } finally {
    delete g.window
  }
})
