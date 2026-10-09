import type {IncomingMessage, ServerResponse} from 'node:http'
import {Readable} from 'node:stream'
import type {Plugin} from 'vite'

// PREVIEW_SOURCE=barkpark: the same three pages, read from Barkpark. The token
// stays here, in the dev server; the browser asks /api/bp/page and listens on
// /api/bp/listen. Drafts when the page asks for them (inside a studio's preview).

type Env = Record<string, string | undefined>
type Doc = {_id: string; _type: string; _publishedId?: string; [k: string]: unknown}
type Ref = {_id: string; _type: string}

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
  const id = (d: Doc) => d._publishedId ?? d._id.replace(/^drafts\./, '')
  const ref = (d: unknown): Ref | undefined => (d && typeof d === 'object' && '_id' in d ? {_id: id(d as Doc), _type: (d as Doc)._type} : undefined)
  const row = (p: Doc) => ({_id: id(p), title: p.title, slug: p.slug, excerpt: p.excerpt, author: ref(p.author) && {_id: id(p.author as Doc), name: (p.author as Doc).name}})
  // A PortableDoc's text blocks, in the shape the page renders (Sanity's blocks).
  const blocks = (body: unknown) =>
    ((body as {blocks?: {id: string; type: string; content?: {value?: string}[]}[]})?.blocks ?? [])
      .filter((b) => b.type === 'paragraph' || b.type === 'heading')
      .map((b) => ({_key: b.id, _type: 'block', children: [{_key: `${b.id}-0`, text: (b.content ?? []).map((c) => c.value ?? '').join('')}]}))
  const seen = (refs: (Ref | undefined)[]) => [...new Map(refs.filter((r): r is Ref => !!r).map((r) => [r._id, r])).values()]

  async function page(kind: string, key: string, perspective: string) {
    if (kind === 'home') {
      const posts = (await query('post', {order: 'title:asc', expand: 'author'}, perspective)).filter((p) => p.slug)
      return {data: posts.map(row), documents: seen(posts.flatMap((p) => [ref(p), ref(p.author)]))}
    }
    if (kind === 'post') {
      const [p] = await query('post', {'filter[slug][eq]': key, expand: 'author,categories,related', limit: '1'}, perspective)
      if (!p) return {data: null, documents: []}
      const related = p.related as Doc | null | undefined
      const categories = ((p.categories as Doc[] | undefined) ?? []).filter((c) => c && typeof c === 'object')
      return {
        data: {
          ...row(p),
          categories: categories.map((c) => ({_id: id(c), title: c.title})),
          body: blocks(p.body),
          related: related && typeof related === 'object' ? {_type: related._type, _id: id(related), title: related.title, name: related.name, slug: related.slug} : undefined,
        },
        documents: seen([ref(p), ref(p.author), ...categories.map(ref), ref(related)]),
      }
    }
    if (kind === 'author') {
      const got = await fetch(`${base}/v1/data/doc/${dataset}/author/${encodeURIComponent(key)}?perspective=${perspective}`, {headers: auth})
      const a = got.ok ? ((await got.json()) as {result: Doc | null}).result : null
      if (!a) return {data: null, documents: []}
      const posts = (await query('post', {'filter[author][eq]': key, order: 'title:asc'}, perspective)).filter((p) => p.slug)
      return {data: {_id: id(a), name: a.name, bio: a.bio, posts: posts.map((p) => ({...row(p), author: {_id: id(a), name: a.name}}))}, documents: seen([ref(a), ...posts.map(ref)])}
    }
    return {data: null, documents: []}
  }

  return {
    name: 'barkpark-preview-api',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = new URL(req.url ?? '/', 'http://x')
        try {
          if (url.pathname === '/api/bp/page') {
            const perspective = url.searchParams.get('perspective') === 'drafts' ? 'drafts' : 'published'
            const out = await page(url.searchParams.get('kind') ?? '', url.searchParams.get('key') ?? '', perspective)
            res.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify({...out, perspective}))
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
