// task-c57dd84f98c1296c: the canvas loads from the hashed names a Barkpark gives, and from
// the plain names when it is older (404), slow, down or answers anything odd.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {askCanvasFiles, PLAIN} from './canvas-files.ts'

const answer = (status: number, body?: unknown) => (async () => new Response(body === undefined ? 'not found' : JSON.stringify(body), {status})) as typeof fetch
const hashed = {script: '/assets/v/abcdefghijklmnop/bp-paper-editor.bundle.js', styles: ['/assets/v/abcdefghijklmnop/bp-paper-editor.css']}

test('a Barkpark that names the files: its hashed paths', async () => {
  let asked = ''
  const get = (async (url: string) => ((asked = url), new Response(JSON.stringify(hashed)))) as typeof fetch
  assert.deepEqual(await askCanvasFiles('https://bp.example', get), hashed)
  assert.equal(asked, 'https://bp.example/v1/embed/canvas')
})

test('an older Barkpark (404), a failure or no network: the plain names', async () => {
  assert.deepEqual(await askCanvasFiles('https://bp.example', answer(404)), PLAIN)
  assert.deepEqual(await askCanvasFiles('https://bp.example', answer(500, {error: 'x'})), PLAIN)
  assert.deepEqual(await askCanvasFiles('https://bp.example', (async () => { throw new TypeError('fetch failed') }) as typeof fetch), PLAIN)
})

test('an answer naming another host, a way out of /assets or no styles: the plain names', async () => {
  for (const body of [
    {...hashed, script: 'https://evil.example/x.js'},
    {...hashed, script: '//evil.example/assets/x.js'},
    {...hashed, styles: ['/assets/../secret.css']},
    {...hashed, styles: []},
    {script: hashed.script},
    'nope',
  ])
    assert.deepEqual(await askCanvasFiles('https://bp.example', answer(200, body)), PLAIN, JSON.stringify(body))
})
