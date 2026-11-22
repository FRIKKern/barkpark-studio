// task-e65341609dbe504b: a filled row of an array of references carries its own problem (a
// target not published) as an empty row does: the mark in the row, and the item's path as the
// row's id, which the validation panel's jump focuses (DocumentPane fieldEl). Mounted in
// happy-dom (as held-press-mount.test.ts), with the targets already read.
import assert from 'node:assert/strict'
import {register} from 'node:module'
import {after, test} from 'node:test'
import {Window} from 'happy-dom'
import {act, createElement as h} from 'react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {createMemoryHistory, createRootRoute, createRouter, RouterContextProvider} from '@tanstack/react-router'

register('./tsx.hooks.mjs', import.meta.url)
globalThis.fetch = async () => {
  throw new Error('no network in this test')
}
const win = new Window({url: 'http://localhost/structure/sak;s'})
const g = globalThis as Record<string, unknown>
for (const k of Object.getOwnPropertyNames(win)) {
  if (k in globalThis) continue
  try {
    g[k] = (win as unknown as Record<string, unknown>)[k]
  } catch {}
}
for (const k of ['window', 'document', 'location', 'getSelection', 'requestAnimationFrame', 'cancelAnimationFrame']) Object.defineProperty(globalThis, k, {configurable: true, writable: true, value: k === 'window' ? win : (win as unknown as Record<string, unknown>)[k]})
g.IS_REACT_ACT_ENVIRONMENT = true
after(() => win.happyDOM.close())

const {RefArrayInput} = await import('../components/RefArrayInput.tsx')
const {ProblemsContext} = await import('../components/Fields.tsx')
const {createRoot} = await import('react-dom/client')

test('a filled reference row shows its own problem and is where the panel jumps; a row without one shows no mark', async () => {
  const field = {name: 'refs', title: 'Medlemmer', type: 'arrayOf', of: {type: 'reference', to: [{type: 'medlem'}]}}
  const value = [{_key: 'a', _type: 'reference', _ref: 'pub'}, {_key: 'b', _type: 'reference', _ref: 'ny'}]
  const qc = new QueryClient({defaultOptions: {queries: {retry: false, staleTime: Infinity}}})
  qc.setQueryData(['doc', 'pub'], {_id: 'pub', _publishedId: 'pub', _type: 'medlem', _hasPublished: true, tittel: 'Publisert'})
  qc.setQueryData(['doc', 'ny'], {_id: 'drafts.ny', _publishedId: 'ny', _type: 'medlem', _draft: true, _hasPublished: false, tittel: 'Utkast'})
  const problems = [{path: 'refs[_key=="b"]', title: 'Medlemmer', message: 'Referenced document must be published', level: 'error'}]
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el as unknown as Element)
  const props = {id: 'refs', field, value, onChange: () => {}, openRef: () => ({href: '#', selected: false, active: false})}
  const router = createRouter({routeTree: createRootRoute({}), context: {queryClient: qc, scope: {current: null}}, history: createMemoryHistory({initialEntries: ['/structure/sak;s']})})
  await act(async () => root.render(h(QueryClientProvider, {client: qc}, h(RouterContextProvider, {router} as never, h(ProblemsContext.Provider, {value: problems as never}, h(RefArrayInput, props as never))))))
  // As DocumentPane's fieldEl finds it (by id; happy-dom's selector parser can't take the escaped quotes).
  const row = (key: string) => document.getElementById(`refs[_key=="${key}"]`)
  assert.ok(row('b'), 'the row with the problem has the item path as its id (the panel jump)')
  assert.equal(row('b')!.querySelectorAll('.error-icon[data-level="error"]').length, 1, 'its mark')
  assert.ok(row('a'), 'every filled row has its id')
  assert.equal(row('a')!.querySelectorAll('.error-icon').length, 0, 'no mark on a row without a problem')
  await act(async () => root.unmount())
})
