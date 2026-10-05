// The only module that knows the Barkpark token. Server-only: importing it from
// client code fails the build.
import '@tanstack/react-start/server-only'

function env(key: string): string {
  const v = process.env[key]
  if (!v) throw new Error(`missing ${key} in .env (see .env.example)`)
  return v
}

const config = () => ({
  base: `${env('BARKPARK_URL')}/w/${env('BARKPARK_WORKSPACE')}/p/${process.env.BARKPARK_PROJECT || 'default'}`,
  dataset: process.env.BARKPARK_DATASET || 'production',
  token: env('BARKPARK_TOKEN'),
})

export const dataset = () => config().dataset

/**
 * Fetch a Barkpark API path (`/v1/...`, dataset already substituted) with the token
 * attached. Every studio user shares this one token, and so its rate bucket: a 429
 * waits out Retry-After (capped) and tries again, up to 3 times, rather than
 * failing a pane. Streams (listen) are not retried here.
 */
export async function bpFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const {base, token} = config()
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${token}`)
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${base}${path}`, {...init, headers})
    if (res.status !== 429 || attempt === 3 || headers.get('accept') === 'text/event-stream') return res
    const wait = Math.min(Number(res.headers.get('retry-after')) || 1, 5)
    console.warn(`[barkpark] 429 on ${path}, retrying in ${wait}s`)
    await new Promise((r) => setTimeout(r, wait * 1000 + Math.random() * 250))
  }
}

/** Pass a Barkpark response through to the browser: status + body + content type, nothing else. */
export async function proxy(path: string, init?: RequestInit): Promise<Response> {
  const res = await bpFetch(path, init)
  return new Response(res.body, {
    status: res.status,
    headers: {'content-type': res.headers.get('content-type') ?? 'application/json'},
  })
}
