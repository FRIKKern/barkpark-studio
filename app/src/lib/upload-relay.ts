// The studio server's half of an upload: the file (already here in full) goes on to
// Barkpark as a stream, so it is known when its last byte has gone out. Cancel in the
// browser closes our request (`gone`):
//  - bytes still going: the upstream request is aborted; Barkpark gets a cut-off body
//    and makes nothing;
//  - all sent: Barkpark may be making the asset this moment, so its answer is awaited
//    and the asset it made deleted.
// A cancelled upload once went on to Barkpark regardless and left the asset behind
// (8 copies of one file after a scout's cancels).

/**
 * The asset a Barkpark upload answer made, to delete when the upload was cancelled. Not
 * one it answered with because it had the same bytes already (`existing`,
 * task-b6e57c37f6928344): that one stays.
 */
export const madeAsset = (answer: unknown): string | undefined => {
  const r = (answer as {result?: {id?: string; existing?: boolean}} | null)?.result
  return r?.existing ? undefined : r?.id
}

export type Sent = {res: Response; cancelled: false} | {res: null; cancelled: true}

const CHUNK = 64 * 1024

/**
 * `send(body, signal)` makes one upstream request; `drop(res)` deletes what a response
 * made. A 429 is sent again (a stream can't be resent, so each try gets a fresh one).
 */
export async function relayUpload(bytes: Uint8Array, gone: AbortSignal, send: (body: ReadableStream<Uint8Array>, signal: AbortSignal) => Promise<Response>, drop: (res: Response) => Promise<unknown>, wait = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<Sent> {
  for (let attempt = 0; ; attempt++) {
    if (gone.aborted) return {res: null, cancelled: true}
    const upstream = new AbortController()
    let sentAll = false
    const onGone = () => sentAll || upstream.abort()
    gone.addEventListener('abort', onGone)
    let i = 0
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (i >= bytes.length) return (sentAll = true), c.close()
        c.enqueue(bytes.subarray(i, (i += CHUNK)))
      },
    })
    try {
      const res = await send(body, upstream.signal)
      if (gone.aborted) {
        if (res.ok) await drop(res)
        return {res: null, cancelled: true}
      }
      if (res.status !== 429 || attempt === 3) return {res, cancelled: false}
      await wait(Math.min(Number(res.headers.get('retry-after')) || 1, 5) * 1000)
    } catch (err) {
      if (upstream.signal.aborted) return {res: null, cancelled: true}
      throw err
    } finally {
      gone.removeEventListener('abort', onGone)
    }
  }
}
