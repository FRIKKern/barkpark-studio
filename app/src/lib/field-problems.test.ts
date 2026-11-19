// task-96c28256661a6179: a field's validation mark never differs between the server's page and the
// browser's first paint. The two can know different problems: a doc made a moment ago stays quiet
// by the clock (components/DocumentPane.tsx `justMade`), and the clock moves between the server's
// render and the browser's hydration. Here the server knew none and the browser knows the required
// slug's; a hydrating render reads useSyncExternalStore's server snapshot, as renderToString does.
import assert from 'node:assert/strict'
import {readdirSync, readFileSync} from 'node:fs'
import {register} from 'node:module'
import {join} from 'node:path'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'
import {createElement as h} from 'react'
import {renderToString} from 'react-dom/server'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import type {Problem} from './validation.ts'

register('./field-problems.hooks.mjs', import.meta.url)
const {FieldView, ProblemsContext} = await import('../components/Fields.tsx')

const field = {name: 'slug', title: 'Slug', type: 'slug', validation: [{flag: 'presence', constraint: 'required'}]}
const required: Problem = {path: 'slug', title: 'Slug', message: 'Required', level: 'error'}
const page = (problems: Problem[]) =>
  renderToString(
    h(QueryClientProvider, {client: new QueryClient()}, h(ProblemsContext.Provider, {value: problems}, h(FieldView, {field, path: 'slug', value: undefined, openRef: () => {}, onChange: () => {}}))),
  )

test("a required empty slug: the browser's first paint draws the server's page, mark and data-invalid alike", () => {
  const server = page([])
  const first = page([required])
  assert.doesNotMatch(server, /data-invalid|slug-problem/, "the server's page draws no mark")
  assert.equal(first.match(/data-invalid="[^"]*"/)?.[0], server.match(/data-invalid="[^"]*"/)?.[0], 'data-invalid')
  assert.equal(first.match(/<[^>]*id="slug-problem"[^>]*>/)?.[0], server.match(/<[^>]*id="slug-problem"[^>]*>/)?.[0], 'the ProblemMark')
  assert.equal(first, server, 'the whole field')
})

test('every component reads the form’s problems through useProblems, never ProblemsContext itself', () => {
  const dir = fileURLToPath(new URL('../components', import.meta.url))
  const reads = readdirSync(dir)
    .filter((f) => f.endsWith('.tsx'))
    .flatMap((f) => [...readFileSync(join(dir, f), 'utf8').matchAll(/useContext\(ProblemsContext\)/g)].map(() => f))
  assert.deepEqual(reads, ['Fields.tsx'], 'one read of ProblemsContext: useProblems’ own')
  assert.match(readFileSync(join(dir, 'Fields.tsx'), 'utf8'), /const all = useContext\(ProblemsContext\)\n {2}return useHydrated\(\) \? all : NO_PROBLEMS/)
})
