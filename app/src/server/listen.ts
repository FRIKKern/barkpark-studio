// One upstream SSE connection per server process, fanned out to browser
// subscribers filtered by document id. Barkpark's listen stream is per dataset;
// the browser only ever sees frames for the ids it asked for.
import '@tanstack/react-start/server-only'
import {bpFetch, dataset} from './barkpark'

type Subscriber = {ids: Set<string>; types: Set<string>; send: (frame: string) => void}

const subscribers = new Set<Subscriber>()
let upstream: AbortController | null = null
let lastEventId: string | null = null

export const publishedId = (id: string) => (id.startsWith('drafts.') ? id.slice(7) : id)

export function subscribe(ids: string[], types: string[], send: Subscriber['send']): () => void {
  const sub = {ids: new Set(ids.map(publishedId)), types: new Set(types), send}
  subscribers.add(sub)
  if (!upstream) void connect()
  return () => {
    subscribers.delete(sub)
    if (subscribers.size === 0) {
      upstream?.abort()
      upstream = null
    }
  }
}

async function connect() {
  const ctrl = new AbortController()
  upstream = ctrl
  let delay = 500
  while (upstream === ctrl) {
    try {
      const headers: Record<string, string> = {accept: 'text/event-stream'}
      if (lastEventId) headers['last-event-id'] = lastEventId
      const res = await bpFetch(`/v1/data/listen/${dataset()}`, {headers, signal: ctrl.signal})
      if (!res.ok || !res.body) throw new Error(`listen ${res.status}`)
      delay = 500
      await pump(res.body)
    } catch (err) {
      if (ctrl.signal.aborted) return
      console.error('[listen] upstream dropped, reconnecting:', (err as Error).message)
    }
    await new Promise((r) => setTimeout(r, delay))
    delay = Math.min(delay * 2, 10_000)
  }
}

async function pump(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder()
  let buf = ''
  for await (const chunk of body) {
    buf += decoder.decode(chunk, {stream: true})
    let end
    while ((end = buf.indexOf('\n\n')) !== -1) {
      dispatch(buf.slice(0, end))
      buf = buf.slice(end + 2)
    }
  }
}

function dispatch(frame: string) {
  let id: string | null = null
  let event = 'message'
  const data: string[] = []
  for (const line of frame.split('\n')) {
    if (line.startsWith('id:')) id = line.slice(3).trim()
    else if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  if (id) lastEventId = id
  if (event !== 'mutation' || data.length === 0) return
  const payload = JSON.parse(data.join('\n')) as {documentId?: string; type?: string}
  if (!payload.documentId) return
  const docId = publishedId(payload.documentId)
  const out = `id: ${id ?? ''}\nevent: mutation\ndata: ${data.join('\n')}\n\n`
  for (const sub of subscribers) if (sub.ids.has(docId) || (payload.type && sub.types.has(payload.type))) sub.send(out)
}
