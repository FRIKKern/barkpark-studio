import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readdirSync, readFileSync} from 'node:fs'

// Every e2e spec takes `test` from e2e/rig/test.ts, whose fixture fails a test on an
// uncaught page error or the studio's error screen; one taken from @playwright/test skips it.
test('e2e specs import test from rig/test, not @playwright/test', () => {
  const dir = new URL('../e2e/journeys/', import.meta.url)
  const files = [...readdirSync(dir).filter((f) => f.endsWith('.spec.ts')).map((f) => new URL(f, dir)), new URL('../e2e/baseline.spec.ts', import.meta.url)]
  const direct = files.filter((f) => /^import [^\n]*from '@playwright\/test'/m.test(readFileSync(f, 'utf8'))).map((f) => f.pathname.split('/').pop())
  assert.deepEqual(direct, [])
})
