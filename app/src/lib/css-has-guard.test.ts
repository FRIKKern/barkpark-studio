import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

// A :has() whose subject is <body> or <html> has Chrome re-check the whole page on every DOM
// change it might affect: two such rules cost 9-28 ms of style work per keystroke at 4x CPU on
// a heavy form (task-31fb868df35d608c). Say such a state on <html> instead (lib/html-mark.ts).
test('no :has() rooted at body, html or :root in styles.css', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const rooted = css.match(/(^|[\s,>+~(}])(body|html|:root)(\[[^\]]*\]|\.[\w-]+)*:has\(/gm) ?? []
  assert.deepEqual(rooted, [])
})
