import type {IncomingMessage, ServerResponse} from 'node:http'
import {Readable} from 'node:stream'
import type {Plugin} from 'vite'

// PREVIEW_SOURCE=barkpark: the same three pages, read from Barkpark; the browser asks
// /api/bp/page and listens on /api/bp/listen. No editor's token here. Inside a
// studio's preview, the editor's studio mints single-use preview tokens (Barkpark's
// scoped route, #22468: one per read or per stream) and the page sends them along,
// comma-separated: drafts or published, as the studio picks, through /v1/preview/*.
// Outside a studio, BARKPARK_SITE_TOKEN, a read-only site token: published only.

type Env = Record<string, string | undefined>
type Doc = {_id: string; _type: string; _publishedId?: string; [k: string]: unknown}
/** Who reads: the studio's preview tokens, one per read (`headers()` takes the next), or the site's own (published). */
type Reader = {route: 'preview' | 'data'; headers: () => Record<string, string>; perspective: 'drafts' | 'published'}
class NoReader extends Error {}

const header = (req: IncomingMessage, name: string) => {
  const v = req.headers[name]
  return (Array.isArray(v) ? v[0] : v) || null
}

export function barkparkApi(env: Env): Plugin {
  const base = `${env.BARKPARK_URL}/w/${env.BARKPARK_WORKSPACE}/p/${env.BARKPARK_PROJECT || 'default'}`
  const dataset = env.PREVIEW_DATASET || env.BARKPARK_DATASET || 'production'
  const reader = (preview: string | null, perspective: string): Reader => {
    if (preview) {
      const left = preview.split(',').filter(Boolean)
      const next = () => {
        const token = left.shift()
        if (!token) throw new Error('the studio sent too few preview tokens for this page')
        return {authorization: `Preview ${token}`}
      }
      return {route: 'preview', headers: next, perspective: perspective === 'drafts' ? 'drafts' : 'published'}
    }
    if (env.BARKPARK_SITE_TOKEN) return {route: 'data', headers: () => ({authorization: `Bearer ${env.BARKPARK_SITE_TOKEN}`}), perspective: 'published'}
    throw new NoReader('Open this site from the studio, or set BARKPARK_SITE_TOKEN for published pages.')
  }
  // J59: with `map`, Barkpark's sourceMap for the rows too (drafts only: a published
  // page has nothing to edit), each row's fields mapped to its own document.
  async function rows(r: Reader, type: string, params: Record<string, string>, map = false) {
    const qs = new URLSearchParams({...params, perspective: r.perspective, limit: params.limit ?? '1000', ...(map && r.perspective === 'drafts' && {sourceMap: 'true'})})
    const res = await fetch(`${base}/v1/${r.route}/query/${dataset}/${type}?${qs}`, {headers: r.headers()})
    if (!res.ok) throw new Error(`Barkpark ${type} → ${res.status}`)
    const body = (await res.json()) as {result: {documents: Doc[]}; sourceMap?: unknown}
    return {documents: body.result.documents, map: body.sourceMap ?? null}
  }
  const doc = (r: Reader, type: string, id: string) =>
    fetch(`${base}/v1/${r.route}/doc/${dataset}/${type}/${encodeURIComponent(id)}?perspective=${r.perspective}${r.perspective === 'drafts' ? '&sourceMap=true' : ''}`, {headers: r.headers()})

  // The documents as Barkpark returns them (references expanded, each one's values
  // mapped to its own document, #22335); src/bp-pages.ts turns them into the page, in
  // the browser, so the studio's unsaved edits apply live.
  async function page(r: Reader, kind: string, key: string) {
    if (kind === 'home') {
      const posts = await rows(r, 'post', {order: 'title:asc', expand: 'author'}, true)
      return {posts: posts.documents, maps: [posts.map]}
    }
    if (kind === 'post') {
      const got = await rows(r, 'post', {'filter[slug][eq]': key, expand: 'author,categories,related', limit: '1'}, true)
      return {post: got.documents[0] ?? null, maps: [got.map]}
    }
    if (kind === 'author') {
      const got = await doc(r, 'author', key)
      const body = got.ok ? ((await got.json()) as {result: Doc | null; sourceMap?: unknown}) : null
      const author = body?.result ?? null
      if (!author) return {author: null, posts: []}
      const posts = await rows(r, 'post', {'filter[author][eq]': key, order: 'title:asc'}, true)
      return {author, maps: [body?.sourceMap ?? null, posts.map], posts: posts.documents}
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
            const r = reader(header(req, 'x-bp-preview'), url.searchParams.get('perspective') === 'drafts' ? 'drafts' : 'published')
            const raw = await page(r, url.searchParams.get('kind') ?? '', url.searchParams.get('key') ?? '')
            res.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify({raw, perspective: r.perspective}))
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
            // EventSource sends no headers: the preview token rides in ?pt= (same origin).
            const r = reader(url.searchParams.get('pt'), url.searchParams.get('pt') ? 'drafts' : 'published')
            const up = await fetch(`${base}/v1/${r.route}/listen/${dataset}`, {headers: {...r.headers(), accept: 'text/event-stream'}, signal: ctrl.signal})
            // Nothing to listen with (a site token may not stream): the page just doesn't update by itself.
            if (!up.ok || !up.body) return void res.writeHead(204).end()
            res.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-cache'})
            Readable.fromWeb(up.body as never).on('error', () => res.end()).pipe(res)
            return
          }
        } catch (err) {
          if (err instanceof NoReader && url.pathname === '/api/bp/listen') return void res.writeHead(204).end()
          if (!res.headersSent) res.writeHead(err instanceof NoReader ? 200 : 500, {'content-type': 'application/json'}).end(JSON.stringify({error: err instanceof NoReader ? err.message : String(err)}))
          return
        }
        next()
      })
    },
  }
}
