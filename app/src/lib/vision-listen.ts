// J37, Vision's Listen, in the browser: reads /api/vision-listen (the query's Barkpark
// listen stream) and hands on each mutation, as Sanity's Vision lists them: newest
// first, the last 50. A refusal (a bad query, an operator filter Barkpark can't stream)
// comes back as its message.

export type ListenEvent = Record<string, unknown>
export const LISTEN_KEEP = 50

export async function listen(
  q: {query: string; perspective: string; dataset: string; params: string; version: string},
  signal: AbortSignal,
  onMutation: (e: ListenEvent) => void,
  onOpen: () => void,
): Promise<string | undefined> {
  const res = await fetch(`/api/vision-listen?${new URLSearchParams(q)}`, {signal, headers: {accept: 'text/event-stream'}}).catch((e: Error) => e)
  if (res instanceof Error) return signal.aborted ? undefined : res.message
  if (!res.ok || !res.body) {
    const text = await res.text()
    try {
      return (JSON.parse(text) as {error?: {message?: string}}).error?.message ?? text
    } catch {
      return text || `Barkpark answered ${res.status}`
    }
  }
  onOpen()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, {stream: true})
      let end
      while ((end = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, end)
        buf = buf.slice(end + 2)
        const event = /^event:\s*(.*)$/m.exec(frame)?.[1]
        const data = [...frame.matchAll(/^data:\s?(.*)$/gm)].map((m) => m[1]).join('\n')
        if (event === 'mutation' && data) onMutation(JSON.parse(data) as ListenEvent)
      }
    }
  } catch (e) {
    if (!signal.aborted) return (e as Error).message
  }
  return undefined
}
