// task-0565a6d09eba038c: an array field's label lights for a problem on any item under it
// (Sanity's), reference, page-builder and plain arrays alike, through the one matcher.
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
const win = new Window({url: 'http://localhost/structure/side;s'})
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

const {FieldView, ProblemsContext} = await import('../components/Fields.tsx')
const {createRoot} = await import('react-dom/client')

async function mount(field: object, value: unknown, problems: object[]) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el as unknown as Element)
  const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
  // A reference row's picker asks the router (its pane links).
  const router = createRouter({routeTree: createRootRoute({}), context: {queryClient: qc, scope: {current: null}}, history: createMemoryHistory({initialEntries: ['/structure/side;s']})})
  await router.load()
  const props = {field, path: (field as {name: string}).name, value, openRef: () => ({href: '#', selected: false, active: false}), onChange: () => {}}
  await act(async () => root.render(h(QueryClientProvider, {client: qc}, h(RouterContextProvider, {router} as never, h(ProblemsContext.Provider, {value: problems as never}, h(FieldView, props as never))))))
  return el
}

const P = (path: string, level = 'error') => ({path, title: 'x', message: `${level} at ${path}`, level})
/** The level of the mark beside the field's own label (or legend), or 'none'. */
const labelMark = (el: Element, path: string) => (el.querySelector(`[id="${path}-label"] > .error-icon, fieldset > legend > .error-icon`)?.getAttribute('data-level') ?? 'none')

const refs = {name: 'refs', title: 'Lenker', type: 'arrayOf', of: {type: 'reference', to: [{type: 'side'}]}}
const builder = {name: 'blokker', title: 'Blokker', type: 'arrayOf', of: [{name: 'faktaboks', title: 'Faktaboks', type: 'composite', fields: [{name: 'tittel', title: 'Tittel', type: 'string'}]}, {name: 'sitat', title: 'Sitat', type: 'composite', fields: [{name: 'tekst', title: 'Tekst', type: 'string'}]}]}
const tags = {name: 'tags', title: 'Stikkord', type: 'arrayOf', of: {type: 'string'}}
const cards = {name: 'kort', title: 'Kort', type: 'arrayOf', of: {name: 'kortet', type: 'composite', fields: [{name: 'tekst', title: 'Tekst', type: 'string'}]}}
const text = {name: 'innhold', title: 'Innhold', type: 'richText', blocks: {of: [{name: 'faktaboks', title: 'Faktaboks', fields: [{name: 'tittel', title: 'Tittel', type: 'string'}]}]}}
const blokk = {name: 'blokk', title: 'Blokk', type: 'composite', fields: [{name: 'tittel', title: 'Tittel', type: 'string'}]}
// A filled reference row is a link (the router's); empty rows are enough for the label.
const item = (k: string, _type: string, f: object) => ({_key: k, _type, ...f})

// [case, field, value, problems, the label's mark]. Main 2a16f429 lights only the field's own path.
const table: [string, object, unknown, object[], string][] = [
  ['reference array: an empty row', refs, [{_key: 'a', _type: 'reference'}, {_key: 'b', _type: 'reference'}], [P('refs[_key=="b"]')], 'error'],
  ['page builder: an item field', builder, [item('x', 'faktaboks', {}), item('y', 'sitat', {tekst: 'Hei'})], [P('blokker[_key=="x"].tittel')], 'error'],
  ['plain array: an item by index', tags, ['a', ''], [P('tags[1]', 'warning')], 'warning'],
  ['object array: worst of its items', cards, [item('k1', 'kortet', {}), item('k2', 'kortet', {})], [P('kort[_key=="k1"].tekst', 'warning'), P('kort[_key=="k2"].tekst')], 'error'],
  // As on main: lit by its own problem, dark by another field's.
  ['array: its own problem', tags, ['a'], [P('tags')], 'error'],
  ['array: a field whose name starts the same', tags, ['a'], [P('tagsX[0]'), P('tags2')], 'none'],
  ['array: no problem', refs, [{_key: 'a', _type: 'reference'}], [], 'none'],
  ["rich text: Barkpark's finding in a block, on the text field", text, [item('f', 'faktaboks', {})], [{...P('innhold'), parents: ['Innhold', 'Faktaboks'], title: 'Tittel'}], 'error'],
  ['rich text: no problem', text, [item('f', 'faktaboks', {tittel: 'T'})], [], 'none'],
  ['open object: a child problem stays on the child', blokk, {}, [P('blokk.tittel')], 'none'],
  ['string: its own problem', {name: 'tittel', title: 'Tittel', type: 'string'}, '', [P('tittel')], 'error'],
]

test('an array field’s label lights for a problem on any item under it, at the worst level; every other label as on main', async () => {
  const got: string[] = []
  for (const [name, field, value, problems] of table) got.push(`${name}: ${labelMark(await mount(field, value, problems), (field as {name: string}).name)}`)
  assert.deepEqual(got, table.map(([name, , , , want]) => `${name}: ${want}`))
})
