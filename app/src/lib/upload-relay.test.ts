import assert from 'node:assert/strict'
import {test} from 'node:test'
import {relayUpload} from './upload-relay.ts'

const bytes = new Uint8Array(300 * 1024) // five chunks
const ok = () => new Response(JSON.stringify({result: {id: 'a1'}}), {status: 200})
const readAll = async (body: ReadableStream<Uint8Array>, each?: (n: number) => void) => {
  const r = body.getReader()
  for (let n = 1; !(await r.read()).done; n++) each?.(n)
}

test('upload relay: a cancel while bytes still go aborts upstream and leaves nothing', async () => {
  const gone = new AbortController()
  let dropped = 0
  const sent = await relayUpload(
    bytes,
    gone.signal,
    async (body, signal) => {
      await readAll(body, (n) => n === 2 && gone.abort())
      assert.equal(signal.aborted, true, 'upstream aborted mid-body')
      throw new DOMException('aborted', 'AbortError')
    },
    async () => dropped++,
  )
  assert.deepEqual(sent, {res: null, cancelled: true})
  assert.equal(dropped, 0)
})

test('upload relay: a cancel after the last byte awaits the answer and deletes what it made', async () => {
  const gone = new AbortController()
  const dropped: string[] = []
  const sent = await relayUpload(
    bytes,
    gone.signal,
    async (body, signal) => {
      await readAll(body)
      gone.abort()
      assert.equal(signal.aborted, false, 'all sent: upstream kept')
      return ok()
    },
    async (res) => dropped.push(((await res.json()) as {result: {id: string}}).result.id),
  )
  assert.deepEqual(sent, {res: null, cancelled: true})
  assert.deepEqual(dropped, ['a1'])
})

test('upload relay: no cancel answers as Barkpark did; a 429 goes again with a fresh stream', async () => {
  let tries = 0
  const sent = await relayUpload(
    bytes,
    new AbortController().signal,
    async (body) => {
      let got = 0
      await readAll(body, () => got++)
      assert.equal(got, 5, 'every try sends the whole file')
      return ++tries === 1 ? new Response('', {status: 429, headers: {'retry-after': '1'}}) : ok()
    },
    async () => assert.fail('nothing to drop'),
    async () => {},
  )
  assert.equal(tries, 2)
  assert.equal(sent.cancelled, false)
  assert.equal(sent.res?.status, 200)
})
