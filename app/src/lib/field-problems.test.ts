// task-96c28256661a6179: a field's validation mark never differs between the server's page and the
// browser's first paint. The two can know different problems: a doc made a moment ago stays quiet
// by the clock (components/DocumentPane.tsx `justMade`), and the clock moves between the server's
// render and the browser's hydration. Here the server knew none and the browser knows the required
// slug's: the browser hydrates the server's page (React, in happy-dom) and must find it its own.
import assert from 'node:assert/strict'
import {readdirSync, readFileSync} from 'node:fs'
import {register} from 'node:module'
import {join} from 'node:path'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'
import {Window} from 'happy-dom'
import {act, createElement as h} from 'react'
import {renderToString} from 'react-dom/server'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import type {Problem} from './validation.ts'

register('./field-problems.hooks.mjs', import.meta.url)
const {FieldView, ProblemsContext} = await import('../components/Fields.tsx')

const field = {name: 'slug', title: 'Slug', type: 'slug', validation: [{flag: 'presence', constraint: 'required'}]}
const required: Problem = {path: 'slug', title: 'Slug', message: 'Required', level: 'error'}
const form = (problems: Problem[]) =>
  h(
    QueryClientProvider,
    {client: new QueryClient()},
    h(ProblemsContext.Provider, {value: problems}, h(FieldView, {field, path: 'slug', value: undefined, openRef: () => ({href: '', selected: false, active: false}), onChange: () => {}})),
  )

test("a required empty slug: the browser hydrates the server's page without a mismatch, then marks the field", async () => {
  const page = renderToString(form([]))
  assert.doesNotMatch(page, /data-invalid|slug-problem/, "the server's page draws no mark")

  // The browser, from here on (this file's process only): happy-dom's window as the globals, as in pt-one-line.test.ts.
  const win = new Window({url: 'http://localhost/'})
  const g = globalThis as Record<string, unknown>
  for (const k of Object.getOwnPropertyNames(win)) {
    if (k in globalThis) continue
    try {
      g[k] = (win as unknown as Record<string, unknown>)[k]
    } catch {}
  }
  for (const k of ['window', 'document', 'getSelection', 'requestAnimationFrame', 'cancelAnimationFrame']) Object.defineProperty(globalThis, k, {configurable: true, writable: true, value: k === 'window' ? win : (win as unknown as Record<string, unknown>)[k]})
  g.IS_REACT_ACT_ENVIRONMENT = true
  const said: string[] = []
  const error = console.error
  console.error = (...a: unknown[]) => void said.push(a.map(String).join(' '))
  try {
    const {hydrateRoot} = await import('react-dom/client')
    const box = win.document.createElement('div')
    box.innerHTML = page
    win.document.body.appendChild(box)
    const recovered: string[] = []
    let root: ReturnType<typeof hydrateRoot> | undefined
    await act(async () => {
      root = hydrateRoot(box as unknown as Element, form([required]), {onRecoverableError: (e) => void recovered.push(String((e as Error).message ?? e))})
    })
    assert.deepEqual(recovered, [], 'no recoverable hydration error (React #418)')
    assert.deepEqual(said.filter((s) => /hydrat|did(n.t| not) match/i.test(s)), [], 'no hydration warning')
    // Hydrated: the field draws the problem the browser knows.
    assert.equal(box.querySelector('.field')?.getAttribute('data-invalid'), 'true', 'data-invalid once hydrated')
    assert.equal(box.querySelector('[id="slug-problem"]')?.getAttribute('aria-label'), 'Validation error: Required', 'the ProblemMark once hydrated')
    await act(async () => root!.unmount())
  } finally {
    console.error = error
    await win.happyDOM.close()
  }
})

test('every component reads the form’s problems through useProblems, never ProblemsContext itself', () => {
  const dir = fileURLToPath(new URL('../components', import.meta.url))
  const reads = readdirSync(dir)
    .filter((f) => f.endsWith('.tsx'))
    .flatMap((f) => [...readFileSync(join(dir, f), 'utf8').matchAll(/useContext\(ProblemsContext\)/g)].map(() => f))
  assert.deepEqual(reads, ['Fields.tsx'], 'one read of ProblemsContext: useProblems’ own')
  assert.match(readFileSync(join(dir, 'Fields.tsx'), 'utf8'), /const all = useContext\(ProblemsContext\)\n {2}return useHydrated\(\) \? all : NO_PROBLEMS/)
})
