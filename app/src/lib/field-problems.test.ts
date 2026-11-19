// task-96c28256661a6179: a field draws the form's problems (its mark, `data-invalid`, an input's
// `invalid`, a reference row's) through one door, useProblems in components/Fields.tsx, so what the
// form shows is decided in one place (components/DocumentPane.tsx, D04's quiet included).
import assert from 'node:assert/strict'
import {readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'

test('every component reads the form’s problems through useProblems, never ProblemsContext itself', () => {
  const dir = fileURLToPath(new URL('../components', import.meta.url))
  const reads = readdirSync(dir)
    .filter((f) => f.endsWith('.tsx'))
    .flatMap((f) => [...readFileSync(join(dir, f), 'utf8').matchAll(/useContext\(ProblemsContext\)/g)].map(() => f))
  assert.deepEqual(reads, ['Fields.tsx'], 'one read of ProblemsContext: useProblems’ own')
  assert.match(readFileSync(join(dir, 'Fields.tsx'), 'utf8'), /export const useProblems = \(\): Problem\[\] => useContext\(ProblemsContext\)\n/)
})
