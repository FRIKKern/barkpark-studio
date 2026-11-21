// task-b3f4ccc4f9cfe129: the document pane, rendered (happy-dom, as doc-quiet.test.ts), on a deep
// link into a fixed type that has no document there. A listed id opens the new-page form, for one
// who may create (the + button's rule, useCanWrite().canWrite); an unlisted id, or a person who may
// not create, gets no form and no new page: the pane's cache keeps "no document".
import assert from 'node:assert/strict'
import {register} from 'node:module'
import {after, test} from 'node:test'
import {Window} from 'happy-dom'
import {act, createElement as h} from 'react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {createMemoryHistory, createRootRoute, createRouter, RouterContextProvider} from '@tanstack/react-router'

register('./tsx.hooks.mjs', import.meta.url)
// No network: the pane's reads are in its cache; anything else fails at once.
const asked: string[] = []
globalThis.fetch = async (url: unknown) => {
  asked.push(String(url))
  throw new Error('no network in this test')
}
Object.defineProperty(globalThis, 'BroadcastChannel', {configurable: true, writable: true, value: undefined})
const interval = globalThis.setInterval
globalThis.setInterval = ((...a: Parameters<typeof interval>) => interval(...a).unref()) as typeof interval

const win = new Window({url: 'http://localhost/structure/side'})
const g = globalThis as Record<string, unknown>
for (const k of Object.getOwnPropertyNames(win)) {
  if (k in globalThis) continue
  try {
    g[k] = (win as unknown as Record<string, unknown>)[k]
  } catch {}
}
for (const k of ['window', 'document', 'getSelection', 'requestAnimationFrame', 'cancelAnimationFrame']) Object.defineProperty(globalThis, k, {configurable: true, writable: true, value: k === 'window' ? win : (win as unknown as Record<string, unknown>)[k]})
g.IS_REACT_ACT_ENVIRONMENT = true
class Quiet extends EventTarget {
  close() {}
}
for (const [k, v] of [['EventSource', Quiet], ['fetch', globalThis.fetch]] as const) {
  g[k] = v
  Object.defineProperty(win, k, {configurable: true, writable: true, value: v})
}
after(async () => {
  await win.happyDOM.close()
})

const {DocumentPane} = await import('../components/DocumentPane.tsx')
const {docQuery, schemasQuery} = await import('./data.ts')
const {meQuery} = await import('./session.ts')
const {forgetEdits} = await import('./edits.ts')
after(() => forgetEdits())

const schema = {name: 'side', title: 'Side', fields: [{name: 'tittel', title: 'Tittel', type: 'string'}], initialValues: {tittel: 'Ny side'}, fixedDocuments: ['side-om-oss', 'side-hva-vi-jobber-med']}

/** The pane on `id`, which has no document; `canWrite` is the signed-in person's. What it shows, and what its cache holds then. */
async function open(id: string, canWrite = true) {
  const qc = new QueryClient({defaultOptions: {queries: {retry: false, staleTime: Infinity, gcTime: Infinity}}})
  qc.setQueryData(schemasQuery.queryKey, [schema])
  qc.setQueryData(docQuery('side', id).queryKey, null)
  qc.setQueryData(meQuery.queryKey, {canWrite, canPublish: canWrite, signIn: 'shared'} as never)
  const panes = [{kind: 'doc', type: 'side', id}]
  const props = {panes, index: 0, split: false, closeHref: '/structure/side', header: h('span', null, 'Side'), closeIcon: null}
  const router = createRouter({routeTree: createRootRoute({}), context: {queryClient: qc, scope: {current: null}}, history: createMemoryHistory({initialEntries: [`/structure/side;${id}`]})})
  await router.load()
  const {createRoot} = await import('react-dom/client')
  const box = win.document.createElement('div')
  win.document.body.appendChild(box)
  const root = createRoot(box as unknown as Element)
  const error = console.error
  console.error = () => {}
  try {
    await act(async () => {
      root.render(h(QueryClientProvider, {client: qc}, h(RouterContextProvider, {router} as never, h(DocumentPane, props as never))))
      await new Promise((r) => setTimeout(r, 20))
    })
  } finally {
    console.error = error
  }
  const seen = {form: !!box.querySelector('[id="tittel"]'), cached: qc.getQueryData<{tittel?: string} | null>(['doc', id]) ?? null}
  await act(async () => root.unmount())
  box.remove()
  return seen
}

test("a deep link to a listed page with no document opens its new-page form, with the type's initial values", async () => {
  const seen = await open('side-om-oss')
  assert.equal(seen.form, true)
  assert.equal(seen.cached?.tittel, 'Ny side')
})

test('an unlisted id of a fixed type opens no form and makes no page; nor does a listed one for a person who may not create', async () => {
  assert.deepEqual(await open('ny-side'), {form: false, cached: null}, 'unlisted')
  assert.deepEqual(await open('side-hva-vi-jobber-med', false), {form: false, cached: null}, 'may not create')
})
