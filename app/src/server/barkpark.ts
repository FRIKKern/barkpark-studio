// The only module that talks to Barkpark. Server-only: importing it from client
// code fails the build. Calls go out with the signed-in editor's own token
// (server/auth.ts), else the studio's BARKPARK_TOKEN.
import '@tanstack/react-start/server-only'
import {getRequestHeader, getRequestUrl} from '@tanstack/react-start/server'
import {currentEditor, devLoginEnabled} from './auth'
import {parseScope, type Scope} from '../lib/scope'

function env(key: string): string {
  const v = process.env[key]
  if (!v) throw new Error(`missing ${key} in .env (see .env.example)`)
  return v
}

/**
 * B02: the workspace, project and dataset this request works in. A page names them in
 * its URL (lib/scope.ts); a server function, an API route or the live stream is asked
 * for by a page, whose URL is its Referer. Neither: the studio's default from .env.
 */
export function scope(): Scope {
  const fallback = {workspace: env('BARKPARK_WORKSPACE'), project: process.env.BARKPARK_PROJECT || 'default', dataset: process.env.BARKPARK_DATASET || 'production'}
  let url: URL
  try {
    url = getRequestUrl()
  } catch {
    return fallback // outside a request (a script, a test)
  }
  const own = parseScope(url.pathname).scope
  if (own) return own
  const referer = getRequestHeader('referer')
  if (!referer) return fallback
  try {
    const page = new URL(referer)
    return (page.host === url.host && parseScope(page.pathname).scope) || fallback
  } catch {
    return fallback
  }
}

const config = (at: Scope = scope()) => ({
  base: `${env('BARKPARK_URL')}/w/${at.workspace}/p/${at.project}`,
  dataset: at.dataset,
  token: currentEditor()?.token ?? env('BARKPARK_TOKEN'),
})

/** The studio's own token, for what isn't any one editor's business (the content model).
 *  A local e2e lane runs on its own member token (scripts/lane-token.mjs) and keeps the
 *  .env token here, since member tokens can't read schemas yet (task-23c4ac86976c46a9). */
export const serviceToken = () => process.env.BARKPARK_SERVICE_TOKEN || env('BARKPARK_TOKEN')

/** The token this request acts with (the editor's, or the studio's). */
export const requestToken = () => config().token

export const dataset = () => config().dataset

/**
 * Fetch a Barkpark API path (`/v1/...`, dataset already substituted) with the token
 * attached (`token` overrides the request's). A 429
 * waits out Retry-After (capped) and tries again, up to 3 times, rather than
 * failing a pane. Streams (listen) are not retried here.
 */
export async function bpFetch(path: string, init: RequestInit = {}, token = requestToken(), {retry = true, at}: {retry?: boolean; at?: Scope} = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase()
  const stream = new Headers(init.headers).get('accept') === 'text/event-stream'
  // Fail closed (task-ccd1876176b0fc08): with sign-in on, a write by nobody — the
  // session was lost to a studio restart or an expired cookie — never goes out under
  // the shared studio token (history would name the wrong author). The editor is
  // told to sign in again; their unsent edits wait.
  if (method !== 'GET' && !stream && devLoginEnabled() && !currentEditor())
    return Response.json({error: {code: 'session_lost', message: "You've been logged out"}}, {status: 401})
  if (method !== 'GET') recent.clear() // a write: no read may answer from before it
  const base = config(at ?? scope()).base
  if (method !== 'GET' || stream) return send(base, path, init, token, retry)
  // Identical reads within READ_DEDUPE_MS share one request: a reload's loader,
  // several panes and the SSR pass ask for the same things at once, and every
  // editor shares this token's read budget (task-2c31de0cf6597d32).
  const key = `${token.slice(-12)} ${base}${path}`
  let hit = recent.get(key)
  if (!hit || hit.expires < Date.now()) {
    hit = {expires: Date.now() + READ_DEDUPE_MS, res: send(base, path, init, token).then(async (r) => ({status: r.status, type: r.headers.get('content-type'), body: await r.text()}))}
    if (recent.size > 500) for (const [k, v] of recent) if (v.expires < Date.now()) recent.delete(k)
    recent.set(key, hit)
  }
  const {status, type, body} = await hit.res
  return new Response(body, {status, headers: type ? {'content-type': type} : {}})
}

export const READ_DEDUPE_MS = 500
const recent = new Map<string, {expires: number; res: Promise<{status: number; type: string | null; body: string}>}>()

async function send(base: string, path: string, init: RequestInit, token: string, retry = true): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${token}`)
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${base}${path}`, {...init, headers})
    if (res.status !== 429 || !retry || attempt === 3 || headers.get('accept') === 'text/event-stream') return res
    const wait = Math.min(Number(res.headers.get('retry-after')) || 1, 5)
    console.warn(`[barkpark] 429 on ${path}, retrying in ${wait}s`)
    await new Promise((r) => setTimeout(r, wait * 1000 + Math.random() * 250))
  }
}

/** A path under the workspace/project prefix (`/media/renditions/...`), raw (binary-safe), with the token. */
export function bpRaw(path: string): Promise<Response> {
  return fetch(`${config().base}${path}`, {headers: {authorization: `Bearer ${requestToken()}`}})
}

/** A media file by the path an asset record gives (`/w/<ws>/p/<project>/media/files/...`), with the token. */
export function bpFile(path: string): Promise<Response> {
  return fetch(`${env('BARKPARK_URL')}${path}`, {headers: {authorization: `Bearer ${requestToken()}`}})
}

/** Pass a Barkpark response through to the browser: status + body + content type, nothing else. */
export async function proxy(path: string, init?: RequestInit): Promise<Response> {
  const res = await bpFetch(path, init)
  return new Response(res.body, {
    status: res.status,
    headers: {'content-type': res.headers.get('content-type') ?? 'application/json'},
  })
}
