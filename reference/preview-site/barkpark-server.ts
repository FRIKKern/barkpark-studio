import type {IncomingMessage, ServerResponse} from 'node:http'
import {Readable} from 'node:stream'
import type {Plugin} from 'vite'

// PREVIEW_SOURCE=barkpark: the same three pages, read from Barkpark. The token
// stays here, in the dev server; the browser asks /api/bp/page and listens on
// /api/bp/listen. Drafts when the page asks for them (inside a studio's preview).

type Env = Record<string, string | undefined>
type Doc = {_id: string; _type: string; _publishedId?: string; [k: string]: unknown}

export function barkparkApi(env: Env): Plugin {
  const base = `${env.BARKPARK_URL}/w/${env.BARKPARK_WORKSPACE}/p/${env.BARKPARK_PROJECT || 'default'}`
  const dataset = env.PREVIEW_DATASET || env.BARKPARK_DATASET || 'production'
  const auth = {authorization: `Bearer ${env.BARKPARK_TOKEN}`}
  const query = async (type: string, params: Record<string, string>, perspective: string) => {
    const qs = new URLSearchParams({...params, perspective, limit: params.limit ?? '1000'})
    const res = await fetch(`${base}/v1/data/query/${dataset}/${type}?${qs}`, {headers: auth})
    if (!res.ok) throw new Error(`Barkpark ${type} → ${res.status}`)
    return ((await res.json()) as {result: {documents: Doc[]}}).result.documents
  }
  // J59: which document and field each value came from (Barkpark's resultSourceMap,
  // flat fields of one document, drafts only: a published page has nothing to edit).
  async function sourceMap(type: string, id: string, perspective: string) {
    if (perspective !== 'drafts') return null
    const got = await fetch(`${base}/v1/data/doc/${dataset}/${type}/${encodeURIComponent(id)}?perspective=drafts&sourceMap=true`, {headers: auth})
    return got.ok ? (((await got.json()) as {sourceMap?: unknown}).sourceMap ?? null) : null
  }

  // The documents as Barkpark returns them (references expanded); src/bp-pages.ts
  // turns them into the page, in the browser, so the studio's unsaved edits apply live.
  async function page(kind: string, key: string, perspective: string) {
    if (kind === 'home') return {posts: (await query('post', {order: 'title:asc', expand: 'author'}, perspective)).filter((p) => p.slug)}
    if (kind === 'post') {
      const post = (await query('post', {'filter[slug][eq]': key, expand: 'author,categories,related', limit: '1'}, perspective))[0] ?? null
      // The author shown on the page is its own document: its own source map (a reference
      // expanded into the post is not mapped yet, task-0e0cb2167c6fcdea).
      const author = post?.author && typeof post.author === 'object' ? (post.author as Doc) : null
      const [own, by] = post ? await Promise.all([sourceMap('post', (post._publishedId as string) ?? post._id, perspective), author ? sourceMap('author', (author._publishedId as string) ?? author._id, perspective) : null]) : [null, null]
      return {post, maps: [own, by]}
    }
    if (kind === 'author') {
      const got = await fetch(`${base}/v1/data/doc/${dataset}/author/${encodeURIComponent(key)}?perspective=${perspective}&sourceMap=true`, {headers: auth})
      const body = got.ok ? ((await got.json()) as {result: Doc | null; sourceMap?: unknown}) : null
      const author = body?.result ?? null
      if (!author) return {author: null, posts: []}
      return {author, maps: [body?.sourceMap ?? null], posts: (await query('post', {'filter[author][eq]': key, order: 'title:asc'}, perspective)).filter((p) => p.slug)}
    }
    return {}
  }

  return {
    name: 'barkpark-preview-api',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = new URL(req.url ?? '/', 'http://x')
        try {
          if (url.pathname === '/api/bp/page') {
            const perspective = url.searchParams.get('perspective') === 'drafts' ? 'drafts' : 'published'
            const raw = await page(url.searchParams.get('kind') ?? '', url.searchParams.get('key') ?? '', perspective)
            res.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify({raw, perspective}))
            return
          }
          // J64: a shared link's document, draft included (Barkpark's public /sp/:token).
          if (url.pathname === '/api/bp/share') {
            const got = await fetch(`${env.BARKPARK_URL}/sp/${encodeURIComponent(url.searchParams.get('token') ?? '')}`)
            res.writeHead(got.ok ? 200 : 404, {'content-type': 'application/json'}).end(got.ok ? await got.text() : '{"error":"This preview link has expired or was turned off."}')
            return
          }
          if (url.pathname === '/api/bp/listen') {
            const ctrl = new AbortController()
            req.on('close', () => ctrl.abort())
            const up = await fetch(`${base}/v1/data/listen/${dataset}`, {headers: {...auth, accept: 'text/event-stream'}, signal: ctrl.signal})
            if (!up.ok || !up.body) return void res.writeHead(502).end()
            res.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-cache'})
            Readable.fromWeb(up.body as never).on('error', () => res.end()).pipe(res)
            return
          }
        } catch (err) {
          if (!res.headersSent) res.writeHead(500, {'content-type': 'application/json'}).end(JSON.stringify({error: String(err)}))
          return
        }
        next()
      })
    },
  }
}
