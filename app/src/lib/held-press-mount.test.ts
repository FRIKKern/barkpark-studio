// task-05dcdef359da08fc (review of #1337): a press on a file box drawn before the editors chunk is done
// by the real input once the chunk lands, through the components themselves: the box drawn meanwhile
// (FileBox, as DocEditors.tsx draws it as the boundary's fallback), React swapping it for the real
// FileInput as the chunk lands, and the real input's own mount (lib/held-act.ts takeHeld). Mounted in
// happy-dom (as doc-quiet.test.ts); the chunk is a lazy component let go by the test.
import assert from 'node:assert/strict'
import {register} from 'node:module'
import {after, test} from 'node:test'
import {Window} from 'happy-dom'
import {act, createElement as h, lazy, Suspense, type ComponentType} from 'react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'

register('./tsx.hooks.mjs', import.meta.url)
globalThis.fetch = async () => {
  throw new Error('no network in this test')
}
const win = new Window({url: 'http://localhost/structure/fieldTypes;f1'})
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

const {FileBox} = await import('../components/FileBox.tsx')
const {FileInput} = await import('../components/FileInput.tsx')
const {createRoot} = await import('react-dom/client')

const field = {name: 'attachment', type: 'file', title: 'Attachment'}

/** A field whose file input is late: the box drawn meanwhile, and `land` to let the chunk in. */
async function lateField() {
  let land!: () => void
  const chunk = new Promise<{default: ComponentType<Record<string, unknown>>}>((r) => (land = () => r({default: FileInput as never})))
  const Real = lazy(() => chunk)
  const props = {id: 'attachment', field, value: undefined, onChange: () => {}, openRef: {current: null}}
  // The form's main column: a field's dialog is drawn over it (FocusScopes.tsx PaneOverlay).
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el as unknown as Element)
  const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
  await act(async () => root.render(h(QueryClientProvider, {client: qc}, h('div', {className: 'doc-main'}, h('div', {className: 'field'}, h(Suspense, {fallback: h(FileBox, props as never)}, h(Real, props)))))))
  const button = (act: string) => el.querySelector<HTMLButtonElement>(`[data-act="${act}"]`)!
  return {el, button, land: () => act(async () => (land(), await chunk)), done: () => act(async () => root.unmount())}
}

test('a Select pressed while the chunk is late opens its dialog once the chunk lands, through the real input', async () => {
  const f = await lateField()
  assert.ok(f.el.querySelector('.file-input'), 'the box is drawn while the chunk is late')
  assert.ok(!f.el.querySelector('[role="dialog"]'))
  f.button('select').focus()
  f.button('select').click()
  assert.ok(!f.el.querySelector('[role="dialog"]'), 'nothing opens before the chunk')
  await f.land()
  assert.ok(f.el.querySelector('[role="dialog"]'), 'the dialog opened as the real input mounted')
  await f.done()
})

test('an Upload pressed while the chunk is late opens the real file chooser once the chunk lands', async () => {
  const f = await lateField()
  f.button('upload').focus()
  f.button('upload').click()
  let chosen = 0
  // The real input's chooser is drawn as it mounts: count clicks on any file input from here on.
  const count = (e: Event) => void ((e.target as Element | null)?.matches?.('input[type=file]') && chosen++)
  document.addEventListener('click', count, true)
  await f.land()
  document.removeEventListener('click', count, true)
  assert.equal(chosen, 1, 'the chooser was opened once')
  await f.done()
})

test('a Select pressed while the chunk is late, then left (the focus elsewhere), opens nothing', async () => {
  const f = await lateField()
  f.button('select').focus()
  f.button('select').click()
  f.button('select').blur()
  await f.land()
  assert.ok(!f.el.querySelector('[role="dialog"]'))
  await f.done()
})
