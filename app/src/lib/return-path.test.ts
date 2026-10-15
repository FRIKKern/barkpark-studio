import {test} from 'node:test'
import assert from 'node:assert/strict'
import {HOME, returnPath} from './return-path.ts'

test('task-f5370d078f463093: /login sends you back to a path on this studio, never off-site', () => {
  for (const ok of ['/structure', '/structure/post;post-01', '/w/ws/p/default/d/production/structure?x=1#y', '/vision', '/structure/a%20b'])
    assert.equal(returnPath(ok), ok)
  const off = [
    undefined, 42, '', 'structure', 'https://example.com', 'javascript:alert(1)', 'data:text/html,x',
    '//example.com', '///example.com', '/\\example.com', '\\\\example.com', '/\t/example.com', '/\n/example.com', ' /structure',
    '/%2F%2Fexample.com', '/%2fexample.com/..', '%2F%2Fexample.com', '/%5Cexample.com', '/%252F%252Fexample.com', '/%2525252F%2525252Fexample.com', '/%E0%A4%A', '/%09/example.com',
  ]
  for (const bad of off) assert.equal(returnPath(bad), HOME, String(bad))
})
