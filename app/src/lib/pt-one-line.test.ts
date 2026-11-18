import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {Window} from 'happy-dom'
import type {Field} from './data.ts'
import {insertable, isOneLine} from './pt-value.ts'

// One-line Portable Text (task-2ba49dd845f77006): a field with options.oneLine runs Sanity's
// OneLinePlugin, so its text stays one block. The real editor runs here, in happy-dom.
const win = new Window({url: 'http://localhost/'})
for (const k of Object.getOwnPropertyNames(win)) {
  if (k in globalThis) continue
  try {
    ;(globalThis as Record<string, unknown>)[k] = (win as unknown as Record<string, unknown>)[k]
  } catch {}
}
for (const k of ['window', 'document', 'getSelection', 'requestAnimationFrame', 'cancelAnimationFrame']) Object.defineProperty(globalThis, k, {configurable: true, writable: true, value: k === 'window' ? win : (win as unknown as Record<string, unknown>)[k]})
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
// The editor's HTML paste asks XPath for Word's and Google Docs' markup; happy-dom has none, and none is here.
;(Object.getPrototypeOf(new win.DOMParser().parseFromString('<p></p>', 'text/html')) as {evaluate: unknown}).evaluate = () => ({snapshotLength: 0, snapshotItem: () => null, iterateNext: () => null})

type Block = {_type: string; _key: string; children?: {text: string}[]}
type Ed = {send: (e: Record<string, unknown>) => void; getSnapshot: () => {context: {value?: Block[]}}}
const block = (key: string, text: string) => ({_type: 'block', _key: key, style: 'normal', markDefs: [], children: [{_type: 'span', _key: `${key}s`, text, marks: []}]})
const caret = (key: string, offset: number, end = offset) => ({type: 'select', at: {anchor: {path: [{_key: key}, 'children', {_key: `${key}s`}], offset}, focus: {path: [{_key: key}, 'children', {_key: `${key}s`}], offset: end}}})
const ONE: Pick<Field, 'options'> = {options: {oneLine: true}}

/** The editor as PortableTextInput mounts it: OneLine first, then the editable. */
async function mount(field: Pick<Field, 'options'>, value: Block[]) {
  const React = await import('react')
  const {createRoot} = await import('react-dom/client')
  const {EditorProvider, PortableTextEditable, defineSchema, useEditor} = await import('@portabletext/editor')
  const {EventListenerPlugin} = await import('@portabletext/editor/plugins')
  const {OneLine} = await import('./pt-one-line.ts')
  const h = React.createElement
  let editor: Ed | undefined
  const patches: unknown[] = []
  const Grab = () => ((editor = useEditor() as unknown as Ed), null)
  const box = document.createElement('div')
  document.body.append(box)
  const root = createRoot(box)
  const act = (f: () => unknown) => React.act(async () => void (await f()))
  const on = (e: {type: string}) => void (e.type === 'patch' || e.type === 'mutation' ? patches.push(e) : 0)
  await act(() => root.render(h(EditorProvider, {initialConfig: {schemaDefinition: defineSchema({}), initialValue: value}}, h(OneLine, {field}), h(EventListenerPlugin, {on}), h(Grab), h(PortableTextEditable))))
  // The editor takes its value a tick after it mounts: a select or key sent before that finds no text.
  await act(() => new Promise((r) => setTimeout(r, 30)))
  const send = (e: Record<string, unknown>) => act(() => editor!.send(e))
  const paste = (data: Record<string, string>) =>
    act(async () => {
      const dt = new win.DataTransfer()
      for (const [type, text] of Object.entries(data)) dt.setData(type, text)
      box.querySelector('[contenteditable]')!.dispatchEvent(new win.ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true}) as unknown as Event)
      await new Promise((r) => setTimeout(r, 20))
    })
  const texts = () => (editor!.getSnapshot().context.value ?? []).map((b) => b.children?.map((c) => c.text).join('') ?? `[${b._type}]`)
  return {send, paste, texts, patches, value: () => editor!.getSnapshot().context.value, done: () => act(() => root.unmount())}
}

test('options.oneLine: the field is one line; it offers no block to insert, and no pasted image goes in as one', () => {
  assert.equal(isOneLine({options: {oneLine: true}}), true)
  for (const options of [undefined, {}, {oneLine: false}, ['oneLine']]) assert.equal(isOneLine({options} as Pick<Field, 'options'>), false, JSON.stringify(options))
  const blocks = {of: ['image', 'table', {name: 'callout'}], inline: [{name: 'chip'}]}
  assert.deepEqual(insertable({blocks, options: {oneLine: true}}, true), {blocks: [], inline: [{name: 'chip'}]}, 'Sanity offers them and drops each insert; none is offered')
  assert.deepEqual(insertable({blocks}, true).blocks.map((b) => b.name), ['image', 'table', 'callout'])
})

test('Enter in a one-line field leaves one block; Shift+Enter breaks no line; Enter over a selection deletes it', async () => {
  const one = await mount(ONE, [block('a', 'Hello world')])
  await one.send(caret('a', 5))
  await one.send({type: 'insert.break'})
  await one.send({type: 'insert.soft break'})
  assert.deepEqual(one.texts(), ['Hello world'])
  await one.send(caret('a', 5, 11))
  await one.send({type: 'insert.break'})
  assert.deepEqual(one.texts(), ['Hello'], 'Enter over " world" deletes it, as Sanity\'s, and splits nothing')
  await one.done()
  // The same keys without oneLine: a new block, then a line break, so the asserts above can fail.
  const many = await mount({}, [block('b', 'Hello world')])
  await many.send(caret('b', 5))
  await many.send({type: 'insert.break'})
  await many.send({type: 'insert.soft break'})
  assert.deepEqual(many.texts(), ['Hello', '\n world'])
  await many.done()
})

test('a paste of several paragraphs, as plain text or HTML, lands in the one block', async () => {
  const one = await mount(ONE, [block('a', 'Hello world')])
  await one.send(caret('a', 6))
  await one.paste({'text/plain': 'one\n\ntwo'})
  assert.deepEqual(one.texts(), ['Hello onetwoworld'], 'the paragraphs join as Sanity\'s plugin joins them')
  await one.paste({'text/html': '<p>three</p><p>four</p>'})
  assert.deepEqual(one.texts(), ['Hello onetwothreefourworld'])
  await one.done()
  const many = await mount({}, [block('b', 'Hello world')])
  await many.send(caret('b', 6))
  await many.paste({'text/plain': 'one\n\ntwo'})
  assert.deepEqual(many.texts(), ['Hello one', 'twoworld'])
  await many.done()
})

test('a stored value of several blocks opens as it is, nothing written; it stays editable and gains no block', async () => {
  const stored = [block('a', 'First line'), block('b', 'Second line')]
  const one = await mount(ONE, stored)
  assert.deepEqual(one.value(), stored, 'opened as stored')
  assert.deepEqual(one.patches, [], 'nothing written by opening it')
  await one.send(caret('b', 11))
  await one.send({type: 'insert.break'})
  assert.deepEqual(one.texts(), ['First line', 'Second line'], 'Enter adds no third block')
  await one.send({type: 'insert.text', text: '!'})
  await one.send(caret('b', 0))
  await one.send({type: 'delete.backward', unit: 'character'})
  assert.deepEqual(one.texts(), ['First lineSecond line!'], 'Backspace joins the two, as in any text')
  await one.done()
})

test('PortableTextInput mounts OneLine first, before the plugins that handle insert events', () => {
  const src = readFileSync(new URL('../components/PortableTextInput.tsx', import.meta.url), 'utf8')
  const at = (s: string) => src.indexOf(s)
  const provider = at('<EditorProvider initialConfig=')
  assert.ok(provider > 0 && at('<OneLine field={field} />') > provider)
  for (const later of ['<NodePlugin nodes={nodes} />', '{tables && <PtTablePlugin />}', '<SanityPlugins field={field} stored={stored} />', '<Saver id={id}']) assert.ok(at('<OneLine field={field} />') < at(later), later)
  assert.match(src, /data-one-line=\{isOneLine\(field\) \|\| undefined\}/)
})
