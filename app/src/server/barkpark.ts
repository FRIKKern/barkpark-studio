// The only module that talks to Barkpark. Server-only: importing it from client
// code fails the build. Calls go out with the signed-in editor's own token
// (server/auth.ts), else the studio's BARKPARK_TOKEN.
import '@tanstack/react-start/server-only'
import {contentModelCredential} from '../lib/content-model-credential'
import {getRequestHeader, getRequestUrl} from '@tanstack/react-start/server'
import {currentEditor, describeToken, signInMode, signInRequired} from './auth'
import {serviceAccess} from '../lib/token-self'
import {parseScope, type Scope} from '../lib/scope'
import {Agent, setGlobalDispatcher, type Dispatcher} from 'undici'

// Keep Barkpark connections open between page opens. Node's fetch drops an idle
// connection after 4 s, so a doc opened after a pause paid a new TCP + TLS handshake
// on every read in its chain: 65 ms more server render (209 ms against 146 warm, e2e-freeform
// on guerrilla, task-2b605087a5f00278). 60 s stays well under Caddy's 5 min idle close.
setGlobalDispatcher(new Agent({keepAliveTimeout: 60_000, keepAliveMaxTimeout: 600_000}))
// Streams (listen, presence) on connections of their own (task-dbd164306efdcde9). A stream
// holds its connection while open and destroys it when it closes (a body abandoned mid-way
// can't be reused), so on the shared pool every tab's presence stream used up one of the
// warm connections: a CI slice of 24 specs opened 52 new ones after the boot warm-up, each a
// new handshake whose lost first SYN costs 1 or 3 s (studio CI's slow first calls).
const streams = new Agent({keepAliveTimeout: 1_000})

function env(key: string): string {
  const v = process.env[key]
  if (!v) throw new Error(`missing ${key} in .env (see .env.example)`)
  return v
}

/** The studio's own workspace, project and dataset (.env). */
const defaultScope = (): Scope => ({workspace: env('BARKPARK_WORKSPACE'), project: process.env.BARKPARK_PROJECT || 'default', dataset: process.env.BARKPARK_DATASET || 'production'})

/**
 * B02: the workspace, project and dataset this request works in. A page names them in
 * its URL (lib/scope.ts); a server function, an API route or the live stream is asked
 * for by a page, whose URL is its Referer. Neither: the studio's default from .env.
 * A Referer is whatever the client says: it picks a workspace, never grants one (reads go
 * with the editor's own token, and serviceToken() checks their seat there).
 */
export function scope(): Scope {
  const fallback = defaultScope()
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
  // J67: with sign-in on nobody reads as the studio. Signed out, a request carries no
  // token and Barkpark refuses it (the routes send the person to sign in first).
  token: currentEditor()?.token ?? (signInRequired() ? '' : env('BARKPARK_TOKEN')),
})

/** The studio's own token. Never handed out as such: serviceToken() and workspaceLocale() below. */
const studioToken = () => process.env.BARKPARK_SERVICE_TOKEN || env('BARKPARK_TOKEN')

/**
 * The studio's own token, for the declared Structure navigation and people pickers.
 * Shared/dev content-model reads keep this path; account schema reads use the editor's
 * session (contentModelToken below). A local e2e lane keeps its .env token here.
 * It reads more than any one editor may, and a request's workspace is only what the request
 * says (its Referer), so with sign-in on it is lent only to a signed-in editor whose own seat
 * is in this workspace; anyone else is refused (task-73a9f8eafae5fbf1: signed out, a forged
 * Referer read any workspace's member emails and schemas).
 */
export async function serviceToken(): Promise<string> {
  if (signInRequired()) {
    const editor = currentEditor()
    const access = serviceAccess(editor && (await describeToken(editor.token)))
    if (access !== 'ok') throw new Error(access === 'signed_out' ? "You've been logged out" : 'You have no access to this workspace')
  }
  return studioToken()
}

/** Account schema/document reads never fall back to the service identity. The backend
 *  checks this editor's session and seat on each read, including after revocation. */
export const contentModelToken = () => contentModelCredential(signInMode(), requestToken, serviceToken)

/**
 * The workspace's locale (its language), with the studio's token: the sign-in screen is in
 * it too. Signed out it is the studio's own workspace's, never one the request names.
 */
export async function workspaceLocale(): Promise<string | undefined> {
  const seated = await serviceToken().then(() => true, () => false)
  const res = await bpFetch('/v1/workspace/locale', {}, studioToken(), {retry: false, at: seated ? undefined : defaultScope()})
  return res.ok ? ((await res.json()) as {locale?: string}).locale : undefined
}

/** The token this request acts with (the editor's, or the studio's). */
export const requestToken = () => config().token

export const dataset = () => config().dataset

/** This request's workspace/project API root (`…/w/<ws>/p/<project>`), for links into Barkpark. */
export const apiBase = () => config().base

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
  if (method !== 'GET' && !stream && signInRequired() && !currentEditor())
    return Response.json({error: {code: 'session_lost', message: "You've been logged out"}}, {status: 401})
  if (method !== 'GET') forgetReads() // a write: no read may answer from before it
  const base = config(at ?? scope()).base
  if (method !== 'GET' || stream) return send(base, path, init, token, retry)
  // Identical reads within READ_DEDUPE_MS share one request: a reload's loader,
  // several panes and the SSR pass ask for the same things at once, and every
  // editor shares this token's read budget (task-2c31de0cf6597d32).
  const key = `${token.slice(-12)} ${base}${path}`
  let hit = recent.get(key)
  if (!hit || hit.expires < Date.now()) {
    const entry: Shared = {expires: Date.now() + (SETTLED.test(path) ? SETTLED_MS : READ_DEDUPE_MS), res: send(base, path, init, token).then(async (r) => {
      if (!r.ok && r.status !== 404) entry.expires = Math.min(entry.expires, Date.now() + READ_DEDUPE_MS) // a refusal isn't kept
      return {status: r.status, type: r.headers.get('content-type'), body: await r.text()}
    })}
    hit = entry
    if (recent.size > 500) for (const [k, v] of recent) if (v.expires < Date.now()) recent.delete(k)
    recent.set(key, hit)
  }
  const {status, type, body} = await hit.res
  return new Response(body, {status, headers: type ? {'content-type': type} : {}})
}

export const READ_DEDUPE_MS = 500
// The content model, the desk, the workspace's language and its members change only when
// someone edits them, and a page load asked for them up to seven times (two schema reads,
// two member pages, the desk doc and tree, the language). Shared for SETTLED_MS, so a change
// shows on the next page loaded 5 s after it. A CI shard made ~650 reads in under a minute
// against Barkpark's 300 a minute (plus 5 a second) per token and dataset, and its last specs
// waited out 429s (task-0fbe272a366541f4); these were ~200 of them.
const SETTLED = /^\/v1\/(schemas\/|structure\/|workspace\/locale|members\?)|\/deskStructure\/deskStructure\?/
const SETTLED_MS = 5_000
/** Drop the shared reads: none may answer for a point after this one. Writes don't move the settled ones. */
export const forgetReads = () => {
  for (const key of recent.keys()) if (!SETTLED.test(key.slice(key.indexOf('/v1/')))) recent.delete(key)
}
/**
 * Someone (anyone) wrote this doc: no read of it may answer from before that. Nor may any
 * "used in" read: the write can add or drop an edge to any doc (J17; Barkpark's edges are
 * right as the write returns since #22591, so a shared read is the only thing in the way).
 */
export const forgetReadsOf = (docId: string) => {
  const needle = `/${encodeURIComponent(docId)}`
  for (const key of recent.keys()) if (key.includes(needle) || key.includes('/v1/data/backlinks/')) recent.delete(key)
}
type Shared = {expires: number; res: Promise<{status: number; type: string | null; body: string}>}
const recent = new Map<string, Shared>()

/** e2e (STUDIO_E2E_HOOKS=1): reads fail as a deploy's reset would, until this time. */
let readBlipUntil = 0
export const e2eReadBlip = (ms: number) => void (readBlipUntil = Date.now() + ms)

/**
 * When Barkpark last refused a token's write (429). In shared mode every editor writes as one
 * token, so one tab's 429 is the whole room's: every write answered within
 * PRESSURE_MS of one tells its browser to space its writes (lib/write-pace.ts).
 */
const limitedAt = new Map<string, number>()
const PRESSURE_MS = 5_000
export const underPressure = (token = requestToken()) => Date.now() - (limitedAt.get(token.slice(-12)) ?? 0) < PRESSURE_MS

const SLOW_MS = 2_000
const BLIP_BUDGET_MS = 6_000

async function send(base: string, path: string, init: RequestInit, token: string, retry = true): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${token}`)
  // A read that meets a Barkpark deploy (the old instance stopping under it: a reset or a
  // 502 from Caddy) is asked again: reads are safe to repeat (J19 flake, 02:07 UTC 2026-10-10).
  // For up to BLIP_BUDGET_MS, backing off: a deploy's gap outlasted two quick tries, and the
  // read that failed then emptied the footer's history or took the page to its error screen
  // (task-f6d036a472f9a813, J04 on CI during a guerrilla deploy, 2026-10-14 23:57 UTC).
  const read = (init.method ?? 'GET').toUpperCase() === 'GET' && headers.get('accept') !== 'text/event-stream'
  const blipStart = Date.now()
  for (let attempt = 0, blips = 0; ; attempt++) {
    const blip = read && Date.now() < readBlipUntil ? Promise.reject(new TypeError('fetch failed (e2e blip)')) : null
    const started = Date.now()
    const stream = headers.get('accept') === 'text/event-stream'
    const res = await (blip ?? fetch(`${base}${path}`, {...init, headers, ...(stream && {dispatcher: streams})} as RequestInit & {dispatcher?: Dispatcher})).catch((err: unknown) => {
      if (!read || Date.now() - blipStart >= BLIP_BUDGET_MS || init.signal?.aborted) throw err
      return null
    })
    // A slow answer goes in the server's log (CI keeps it as preview.log): J37's share once
    // took over 5 s on CI with no 429 logged, and nothing said where the time went.
    const took = Date.now() - started
    if (took > SLOW_MS && headers.get('accept') !== 'text/event-stream') console.warn(`${new Date().toISOString()} [barkpark] slow ${(init.method ?? 'GET').toUpperCase()} ${path.split('?')[0]}: ${took} ms → ${res?.status ?? 'failed'}`)
    if (!res || (read && Date.now() - blipStart < BLIP_BUDGET_MS && [502, 503, 504].includes(res.status))) {
      if (!blips) console.warn(`${new Date().toISOString()} [barkpark] ${res?.status ?? 'failed'} on GET ${path.split('?')[0]}, asking again`)
      await new Promise((r) => setTimeout(r, Math.min(300 * 2 ** blips++, 1_500)))
      continue
    }
    if (res.status === 429 && !read) limitedAt.set(token.slice(-12), Date.now())
    if (res.status !== 429 || !retry || attempt === 3 || headers.get('accept') === 'text/event-stream') return res
    const wait = Math.min(Number(res.headers.get('retry-after')) || 1, 5)
    console.warn(`${new Date().toISOString()} [barkpark] 429 on ${path}, retrying in ${wait}s`)
    await new Promise((r) => setTimeout(r, wait * 1000 + Math.random() * 250))
  }
}

/** B02: a Barkpark path outside any workspace (`/api/workspaces/…`), as this request's token. */
export function bpRoot(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${env('BARKPARK_URL')}${path}`, {...init, headers: {...(init.headers as Record<string, string>), authorization: `Bearer ${requestToken()}`}})
}

/** A path under the workspace/project prefix (`/media/renditions/...`), raw (binary-safe), with the token. */
export function bpRaw(path: string): Promise<Response> {
  return fetch(`${config().base}${path}`, {headers: {authorization: `Bearer ${requestToken()}`}})
}

/** A media file by the path an asset record gives (`/w/<ws>/p/<project>/media/files/...`), with the token. */
export function bpFile(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${env('BARKPARK_URL')}${path}`, {headers: {...headers, authorization: `Bearer ${requestToken()}`}})
}

/** Pass a Barkpark response through to the browser: status + body + content type, nothing else. */
export async function proxy(path: string, init?: RequestInit): Promise<Response> {
  const res = await bpFetch(path, init)
  return new Response(res.body, {
    status: res.status,
    headers: {'content-type': res.headers.get('content-type') ?? 'application/json'},
  })
}
