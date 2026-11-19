// task-96c28256661a6179: a field's validation mark never differs between the server's page and the
// browser's first paint. D04 keeps a doc made a moment ago quiet (no marks) until the first edit;
// "a moment ago" was judged by the clock in DocumentPane's render, and the clock moved between the
// server's render and the browser's hydration (a slow cold start: 3 of 7). Now it is judged by the
// page's load time (lib/pane-clock.ts), which travels with the route's data. Two clocks here, faked,
// never slept: the server renders at T, the browser hydrates at T + 20 s, both on the load at T.
import assert from 'node:assert/strict'
import {register} from 'node:module'
import {after, test} from 'node:test'
import {Window} from 'happy-dom'
import {act, createElement as h, type ReactElement} from 'react'
import {renderToString} from 'react-dom/server'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {createMemoryHistory, createRootRoute, createRouter, RouterContextProvider} from '@tanstack/react-router'

register('./tsx.hooks.mjs', import.meta.url)
// No network (the pane's reads are in its cache; anything else fails at once), and no module-wide
// channel holding the process open.
globalThis.fetch = async () => {
  throw new Error('no network in this test')
}
Object.defineProperty(globalThis, 'BroadcastChannel', {configurable: true, writable: true, value: undefined})
// A page-wide tick never stops in a browser (lib/now.ts useNow, every 30 s); here it must not hold the process open.
const interval = globalThis.setInterval
globalThis.setInterval = ((...a: Parameters<typeof interval>) => interval(...a).unref()) as typeof interval
const {DocumentPane} = await import('../components/DocumentPane.tsx')
const {LoadedAtContext} = await import('./pane-clock.ts')
const {docQuery, schemasQuery} = await import('./data.ts')

const T = Date.parse('2026-11-20T12:00:00Z')
const LATER = T + 20_000
const schema = {
  name: 'post',
  title: 'Post',
  groups: [{name: 'main', title: 'Main'}],
  fields: [
    {name: 'title', title: 'Title', type: 'string', group: 'main'},
    {name: 'slug', title: 'Slug', type: 'slug', group: 'main', validation: {required: true}},
  ],
}
/** A doc saved, never published, with an empty required slug, created `ago` ms before T. */
const post = (ago: number) => ({_id: 'drafts.p1', _publishedId: 'p1', _type: 'post', _rev: 'r1', _draft: true, _hasPublished: false, _createdAt: new Date(T - ago).toISOString(), _updatedAt: new Date(T - ago).toISOString(), title: 'Pasted'})

const realNow = Date.now
/** The pane as the structure route mounts it, on a load at T, with the clock reading `now`. */
async function pane(now: number, ago: number): Promise<ReactElement> {
  Date.now = () => now
  // gcTime Infinity: no cache-collection timer (5 min) holding the process open after the pane unmounts.
  const qc = new QueryClient({defaultOptions: {queries: {retry: false, staleTime: Infinity, gcTime: Infinity}}})
  qc.setQueryData(schemasQuery.queryKey, [schema])
  qc.setQueryData(docQuery('post', 'p1').queryKey, post(ago))
  const panes = [{kind: 'doc', type: 'post', id: 'p1'}]
  const props = {panes, index: 0, split: false, closeHref: '/structure/post', header: h('span', null, 'Post'), closeIcon: null}
  const root = createRootRoute({})
  // The router is scaffolding: the pane reads its location and context, nothing renders its matches.
  const router = createRouter({routeTree: root, context: {queryClient: qc, scope: {current: null}}, history: createMemoryHistory({initialEntries: ['/structure/post;p1']})})
  await router.load()
  return h(QueryClientProvider, {client: qc}, h(RouterContextProvider, {router} as never, h(LoadedAtContext.Provider, {value: T}, h(DocumentPane, props as never))))
}
const server = async (ago: number, now = T) => renderToString(await pane(now, ago))

// The browser, for the hydrating half: happy-dom's window as the globals (as pt-one-line.test.ts),
// installed after every server render of this file has run.
let win: Window | undefined
function browser() {
  if (win) return win
  win = new Window({url: 'http://localhost/structure/post;p1'})
  const g = globalThis as Record<string, unknown>
  for (const k of Object.getOwnPropertyNames(win)) {
    if (k in globalThis) continue
    try {
      g[k] = (win as unknown as Record<string, unknown>)[k]
    } catch {}
  }
  for (const k of ['window', 'document', 'getSelection', 'requestAnimationFrame', 'cancelAnimationFrame']) Object.defineProperty(globalThis, k, {configurable: true, writable: true, value: k === 'window' ? win : (win as unknown as Record<string, unknown>)[k]})
  g.IS_REACT_ACT_ENVIRONMENT = true
  // No network from the browser either: happy-dom's EventSource (the live stream) and fetch would dial localhost.
  class Quiet extends EventTarget {
    close() {}
  }
  for (const [k, v] of [['EventSource', Quiet], ['fetch', globalThis.fetch]] as const) {
    g[k] = v
    Object.defineProperty(win, k, {configurable: true, writable: true, value: v})
  }
  return win
}
after(async () => {
  Date.now = realNow
  await win?.happyDOM.close()
})

/** Hydrates the server's page at LATER: what React said about it, and the hydrated page. */
async function hydrate(page: string, ago: number) {
  const w = browser()
  const {hydrateRoot} = await import('react-dom/client')
  const box = w.document.createElement('div')
  box.innerHTML = page
  w.document.body.appendChild(box)
  const recovered: string[] = []
  const said: string[] = []
  const error = console.error
  console.error = (...a: unknown[]) => void said.push(a.map(String).join(' '))
  const app = await pane(LATER, ago)
  let root: ReturnType<typeof hydrateRoot> | undefined
  try {
    await act(async () => {
      root = hydrateRoot(box as unknown as Element, app, {onRecoverableError: (e) => void recovered.push(String((e as Error).message ?? e).split('\n')[0])})
    })
  } finally {
    console.error = error
  }
  return {box, recovered, warned: said.filter((s) => /hydrat|did(n.t| not) match/i.test(s)), unmount: () => act(async () => root!.unmount())}
}
const marks = (html: string) => ({mark: /id="slug-problem"/.test(html), invalid: /data-invalid="true"/.test(html)})

test('a doc made 5 s before the load: the browser hydrates it 20 s later without a mismatch, quiet until the first edit, then marked', async () => {
  const page = await server(5_000)
  assert.deepEqual(marks(page), {mark: false, invalid: false}, "the server's page is quiet")
  const {box, recovered, warned, unmount} = await hydrate(page, 5_000)
  assert.deepEqual(recovered, [], 'no recoverable hydration error (React #418)')
  assert.deepEqual(warned, [], 'no hydration warning')
  assert.deepEqual(marks(box.innerHTML), {mark: false, invalid: false}, 'still quiet once hydrated, 20 s on')
  // D04: the first edit ends the quiet (an input anywhere in the form, its effect a tick later).
  await act(async () => {
    box.querySelector('[id="title"]')!.dispatchEvent(new win!.Event('input', {bubbles: true}))
    await new Promise((r) => setTimeout(r, 0))
  })
  assert.deepEqual(marks(box.innerHTML), {mark: true, invalid: true}, 'marked after the first edit')
  await unmount()
})

test('a doc made an hour before the load keeps its marks in the server HTML, and hydrates on them', async () => {
  const page = await server(3_600_000)
  assert.deepEqual(marks(page), {mark: true, invalid: true}, "the server's page marks the empty required slug")
  const {box, recovered, warned, unmount} = await hydrate(page, 3_600_000)
  assert.deepEqual([...recovered, ...warned], [], 'no hydration error or warning')
  assert.deepEqual(marks(box.innerHTML), {mark: true, invalid: true})
  await unmount()
})

test('the header validation button and the group tabs: the same on the server and the first paint, 20 s apart', async () => {
  const page = await server(5_000)
  const button = (html: string) => html.match(/<button[^>]*validation-btn[^>]*>/)?.[0].match(/data-problems="(\d+)"/)?.[1]
  const tab = (html: string) => html.match(/id="group-tab-main"[^>]*>Main<span class="error-icon" data-level="(\w+)"/)?.[1] ?? 'none'
  // D04: publishing still checks everything, so these show the problem even while the fields are quiet.
  assert.equal(button(page), '1', "the server's validation button counts the problem")
  assert.equal(tab(page), 'error', "the server's Main tab marks it")
  const {box, recovered, warned, unmount} = await hydrate(page, 5_000)
  assert.deepEqual([...recovered, ...warned], [], 'no hydration error or warning')
  assert.equal(button(box.innerHTML), '1', 'the hydrated button')
  assert.equal(tab(box.innerHTML), 'error', 'the hydrated tab')
  await unmount()
})

// A route's data can come from the router's cache (back to the doc a minute later, no reload; a
// link's preload): its `at` is the first load's. The pane judges by it, never the clock, so it opens
// as it did then: a doc that was quiet on its first open is quiet again, until the first edit.
test("a cached load: opened a minute after a load at T, a doc made 5 s before that load is judged by the load, not the clock", async () => {
  assert.deepEqual(marks(await server(5_000, T + 60_000)), {mark: false, invalid: false}, 'quiet, as at its first open')
  assert.deepEqual(marks(await server(60_000, T + 60_000)), {mark: true, invalid: true}, 'a doc made a minute before the load is marked')
})
