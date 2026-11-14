import {resolve} from 'node:path'
import type {IncomingMessage, ServerResponse} from 'node:http'
import {defineConfig, loadEnv, type Plugin} from 'vite'
import react from '@vitejs/plugin-react'
import {createClient, type ClientPerspective} from '@sanity/client'
import {validatePreviewUrl} from '@sanity/preview-url-secret'
import {barkparkApi} from './barkpark-server'

// The reference project's dataset is private, so the token stays here, server side.
// The browser asks /api/query; draft mode (Presentation's enable URL) picks drafts.
const env = loadEnv('development', resolve(__dirname, '../..'), 'SANITY_')
const STUDIO_URL = env.SANITY_STUDIO_URL || 'http://localhost:3333'
const client = createClient({
  projectId: 'ecu57yeh',
  dataset: env.SANITY_STUDIO_DATASET || 'production',
  apiVersion: '2025-02-19',
  useCdn: false,
  token: env.SANITY_TOKEN,
  stega: {studioUrl: STUDIO_URL},
})
const COOKIE = 'preview-perspective'

function perspectiveOf(req: IncomingMessage): ClientPerspective {
  const m = /(?:^|;\s*)preview-perspective=([^;]+)/.exec(req.headers.cookie ?? '')
  return m ? (decodeURIComponent(m[1]) as ClientPerspective) : 'published'
}

async function body(req: IncomingMessage) {
  let s = ''
  for await (const chunk of req) s += chunk
  return JSON.parse(s || '{}')
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {'content-type': 'application/json'}).end(JSON.stringify(data))
}

function api(): Plugin {
  return {
    name: 'preview-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://x')
        try {
          if (url.pathname === '/api/query' && req.method === 'POST') {
            const {query, params} = await body(req)
            const perspective = perspectiveOf(req)
            const {result, resultSourceMap} = await client.fetch(query, params ?? {}, {
              perspective,
              filterResponse: false,
              resultSourceMap: 'withKeyArraySelector',
              stega: perspective !== 'published',
            })
            return json(res, 200, {data: result, sourceMap: resultSourceMap, perspective})
          }
          if (url.pathname === '/api/draft-mode/enable') {
            const {isValid, redirectTo = '/', studioPreviewPerspective} = await validatePreviewUrl(
              client.withConfig({token: env.SANITY_TOKEN}),
              url.toString(),
            )
            if (!isValid) return json(res, 401, {error: 'Invalid secret'})
            const perspective = studioPreviewPerspective || 'drafts'
            res.writeHead(307, {
              location: redirectTo,
              'set-cookie': `${COOKIE}=${encodeURIComponent(perspective)}; Path=/; SameSite=Lax`,
            })
            return res.end()
          }
          if (url.pathname === '/api/draft-mode/disable') {
            res.writeHead(307, {location: '/', 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`})
            return res.end()
          }
        } catch (err) {
          return json(res, 500, {error: String(err)})
        }
        next()
      })
    },
  }
}

// PREVIEW_SOURCE=barkpark reads the same pages from Barkpark (barkpark-server.ts).
const SOURCE = process.env.PREVIEW_SOURCE === 'barkpark' ? 'barkpark' : 'sanity'
// PREVIEW_SOURCE=sanity-on-barkpark: the Sanity code path as a next-sanity site runs it
// (@sanity/client, <VisualEditing>, useLiveMode), its client pointed at Barkpark's
// Sanity-compatible API. No token and no server route here: inside Barkpark Studio's
// Presentation the studio runs the page's queries (comlink's loader channel).
const bp = {...loadEnv('development', resolve(__dirname, '../..'), 'BARKPARK_'), ...process.env}
const ON_BARKPARK = process.env.PREVIEW_SOURCE === 'sanity-on-barkpark'
const API_HOST = ON_BARKPARK ? `${bp.BARKPARK_URL}/w/${bp.BARKPARK_WORKSPACE}/p/${bp.BARKPARK_PROJECT || 'default'}` : ''

export default defineConfig({
  plugins: [react(), ...(ON_BARKPARK ? [] : [SOURCE === 'barkpark' ? barkparkApi(bp) : api()])],
  define: {
    __SOURCE__: JSON.stringify(SOURCE),
    __API_HOST__: JSON.stringify(API_HOST),
    __STUDIO_URL__: JSON.stringify(ON_BARKPARK ? process.env.PREVIEW_STUDIO_URL || 'http://localhost:3000' : STUDIO_URL),
    __DATASET__: JSON.stringify(ON_BARKPARK ? bp.PREVIEW_DATASET || bp.BARKPARK_DATASET || 'production' : env.SANITY_STUDIO_DATASET || 'production'),
  },
})
