import {test, after} from 'node:test'
import assert from 'node:assert/strict'
import {register} from 'node:module'
import {QueryClient} from '@tanstack/react-query'
// T4 (task-f4c80d82cc25b19b): a create Barkpark refuses because the type has a fixed set of
// documents (409 fixed_document: the tab read its schema before the list was set) is a final
// refusal. lib/edits.ts against a Barkpark kept in memory (save-flow.hooks.mjs): one call, no
// retry, Barkpark's reason in the editor's words, the values kept, and createDoc rejects so the
// Duplicate and Translations toasts run. It was "Not saved — retrying" every 2 s, forever.
register('./save-flow.hooks.mjs', import.meta.url)
Object.defineProperty(globalThis.navigator, 'onLine', {value: true, configurable: true})
let calls = 0
const refusal = {error: {code: 'fixed_document', message: 'side has a fixed set of documents', details: {action: 'create', type: 'side', id: 'side-ny'}}}
;(globalThis as Record<string, unknown>).saveFlowServer = {
  read: async () => null,
  fetch: async () => (calls++, {ok: false, status: 409, json: async () => refusal}),
}
const E = await import('./edits.ts')
after(() => E.forgetEdits())

test('a create refused with 409 fixed_document: one call, refused in plain words, values kept, createDoc rejects', async () => {
  const qc = new QueryClient()
  const made = E.createDoc(qc, 'side', 'side-ny', {asIs: {tittel: 'Kopi av Om oss'}})
  const settled = await Promise.race([made.then(() => 'resolved', (err: Error) => err.message), new Promise((go) => setTimeout(() => go('pending'), 3000))])
  assert.equal(settled, 'side has a fixed set of documents. A new one cannot be created.')
  // No retry: the 2 s timer of a plain failure would have sent it again by now.
  await new Promise((go) => setTimeout(go, 2100))
  assert.equal(calls, 1)
  assert.equal(E.saveStateOf('side-ny'), 'refused')
  assert.equal((qc.getQueryData(['doc', 'side-ny']) as {tittel?: string} | undefined)?.tittel, 'Kopi av Om oss')
  assert.equal(E.hasUnsaved(), true)
})
