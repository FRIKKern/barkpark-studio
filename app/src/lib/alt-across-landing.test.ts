// task-05dcdef359da08fc (review of #1337, P1): an image's own fields (Alt) are drawn outside the
// editors chunk's boundary (components/ImageBox.tsx ImageFrame), so typing in Alt goes on while the
// chunk is late and as it lands: the same input, every letter, the focus kept. A Select pressed on the
// image before the person moved on to Alt opens nothing as the chunk lands (lib/held-act.ts). Mounted
// in happy-dom (as held-press-mount.test.ts): ImageFrame, a Suspense boundary with ImageBox as its
// fallback (as DocEditors.tsx draws it), and the real ImageInput as a lazy component let go by the test.
import assert from 'node:assert/strict'
import {register} from 'node:module'
import {after, test} from 'node:test'
import {Window} from 'happy-dom'
import {act, createElement as h, lazy, Suspense, useState, type ComponentType} from 'react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'

register('./tsx.hooks.mjs', import.meta.url)
globalThis.fetch = async () => {
  throw new Error('no network in this test')
}
const win = new Window({url: 'http://localhost/structure/post;p1'})
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

const {ImageBox, ImageFrame} = await import('../components/ImageBox.tsx')
const {ImageInput} = await import('../components/ImageInput.tsx')
const {createRoot} = await import('react-dom/client')

const field = {name: 'mainImage', type: 'image', title: 'Main image', fields: [{name: 'alt', type: 'string', title: 'Alternative text'}]}

/** Types into a React input as the browser does: the value set natively, then its input event. */
function type(input: HTMLInputElement, text: string) {
  for (const ch of text) {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, input.value + ch)
    input.dispatchEvent(new win.Event('input', {bubbles: true}) as unknown as Event)
  }
}

test("typing in an image's Alt while the chunk is late, after a press on Select, keeps the input, every letter and the focus as it lands; nothing opens", async () => {
  let land!: () => void
  const chunk = new Promise<{default: ComponentType<Record<string, unknown>>}>((r) => (land = () => r({default: ImageInput as never})))
  const Real = lazy(() => chunk)
  const values: unknown[] = []
  function Field() {
    const [value, setValue] = useState<unknown>(undefined)
    const props = {id: 'mainImage', field, value, onChange: (v: unknown) => (values.push(v), setValue(v)), openRef: {current: null}}
    return h(ImageFrame, props as never, h(Suspense, {fallback: h(ImageBox, props as never)}, h(Real, props)))
  }
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el as unknown as Element)
  const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
  // The form's main column: a field's dialog is drawn over it (FocusScopes.tsx PaneOverlay).
  await act(async () => root.render(h(QueryClientProvider, {client: qc}, h('div', {className: 'doc-main'}, h(Field)))))

  const alt = el.querySelector<HTMLInputElement>('[id="mainImage.alt"]')
  assert.ok(alt, 'Alt is drawn while the chunk is late')
  const select = el.querySelector<HTMLButtonElement>('[id="mainImage"] [data-act="select"]')!
  select.focus()
  select.click()
  alt.focus()
  await act(async () => type(alt, 'Held '))
  await act(async () => (land(), await chunk))
  await act(async () => type(document.activeElement as HTMLInputElement, 'and landed'))

  const after = el.querySelector<HTMLInputElement>('[id="mainImage.alt"]')
  assert.ok(after === alt, 'the same Alt input across the landing')
  // (Compared as booleans: a failed check would print the whole DOM node.)
  assert.ok(document.activeElement === alt, `the focus stayed in Alt (it is on ${document.activeElement?.tagName.toLowerCase()}[data-act=${document.activeElement?.getAttribute('data-act')}])`)
  assert.equal(alt.value, 'Held and landed', 'every letter')
  assert.deepEqual((values.at(-1) as {alt?: string} | undefined)?.alt, 'Held and landed', 'the form was given every letter')
  assert.ok(!el.querySelector('[role="dialog"]'), 'the Select pressed before the person moved on opened nothing')
  await act(async () => root.unmount())
})
