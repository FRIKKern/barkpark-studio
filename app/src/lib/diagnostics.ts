import {createServerFn} from '@tanstack/react-start'
import {queryOptions} from '@tanstack/react-query'
import {bpFetch, bpRoot, dataset} from '../server/barkpark'

// J69: what a bug report needs about the Barkpark this studio talks to: where it is, its
// version and commit (`GET /v1/version`), and its admin page (Manage project: members & roles).

type Json = string | number | boolean | null | Json[] | {[k: string]: Json}
export type BarkparkInfo = {url: string; version: string | null; commit: string | null; adminUrl: string}

const fetchInfo = createServerFn({method: 'GET'}).handler(async () => {
  const url = process.env.BARKPARK_URL ?? ''
  const v = await bpRoot('/v1/version')
    .then((r) => (r.ok ? (r.json() as Promise<{version?: string; commit?: string}>) : null))
    .catch(() => null)
  return {url, version: v?.version ?? null, commit: v?.commit ?? null, adminUrl: url ? `${url}/studio/org-admin` : ''} as unknown as Json
})

export const barkparkInfoQuery = queryOptions({queryKey: ['barkpark-info'], queryFn: async () => (await fetchInfo()) as unknown as BarkparkInfo, staleTime: Infinity})


/** One connection test, Sanity's shape: what was asked, how it went, how long it took. */
export type Check = {path: string; status: 'success' | 'error'; detail: string; durationMs: number; timedOut: boolean}

const TIMEOUT_MS = 5_000
const round = (ms: number) => Math.round(ms * 10) / 10

/** Time a request; `read` says how it went (its detail), or throws for a failure. */
async function timed(path: string, run: (signal: AbortSignal) => Promise<string>): Promise<Check> {
  const t0 = performance.now()
  try {
    const detail = await run(AbortSignal.timeout(TIMEOUT_MS))
    return {path, status: 'success', detail, durationMs: round(performance.now() - t0), timedOut: false}
  } catch (e) {
    const timedOut = (e as Error).name === 'TimeoutError'
    return {path, status: 'error', detail: timedOut ? `no answer in ${TIMEOUT_MS / 1000} s` : (e as Error).message, durationMs: round(performance.now() - t0), timedOut}
  }
}

/**
 * J69, Sanity's API request tests, asked of Barkpark from the studio's server (where the
 * studio talks to it): reachable, a one-row query, a missing doc (404, as expected), and
 * the media library. Returns the first image's id for the browser's media test.
 */
export const runServerChecks = createServerFn({method: 'GET'})
  .validator((d: {type: string}) => d)
  .handler(async ({data}) => {
    const ds = dataset()
    const type = encodeURIComponent(data.type)
    let image: string | null = null
    const checks: Check[] = [
      await timed('/v1/version', async (signal) => {
        const r = await bpRoot('/v1/version', {signal})
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const v = (await r.json()) as {version?: string}
        return `Barkpark reached (${v.version ?? 'version unknown'})`
      }),
      await timed(`/v1/data/query/${ds}/${type}?limit=1`, async (signal) => {
        // A fresh URL each run: the studio's server shares identical reads for a moment (bpFetch), which would time the cache.
        const r = await bpFetch(`/v1/data/query/${ds}/${type}?limit=1&diagnostics=${Date.now()}`, {signal})
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const n = ((await r.json()) as {result?: {documents?: unknown[]}}).result?.documents?.length ?? 0
        return n ? 'document ID received' : 'no documents (the query answered)'
      }),
      await timed(`/v1/data/doc/${ds}/${type}/<random-nonexistent-id>`, async (signal) => {
        const r = await bpFetch(`/v1/data/doc/${ds}/${type}/diagnostics-${crypto.randomUUID()}`, {signal})
        if (r.status !== 404) throw new Error(`HTTP ${r.status}, expected 404`)
        return 'document not found (as expected)'
      }),
      await timed(`/v1/media/${ds}?type=image&limit=1`, async (signal) => {
        const r = await bpFetch(`/v1/media/${ds}?type=image&limit=1&diagnostics=${Date.now()}`, {signal})
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const {result} = (await r.json()) as {result?: {assets?: {id: string}[]; total?: number}}
        image = result?.assets?.[0]?.id ?? null
        return `media library reached (${result?.total ?? 0} images)`
      }),
    ]
    return {checks, image} as unknown as Json
  })

/** The studio server, from the browser: its time to first byte and the protocol, as Sanity's /ping. */
export async function pingStudio() {
  const url = `/api/version?diagnostics=${Date.now()}`
  // An observer, not getEntries(): a busy page fills the timing buffer (250 entries) and later requests are dropped from it.
  let timing: PerformanceResourceTiming | undefined
  const seen = new Promise<void>((done) => {
    const observer = new PerformanceObserver((list) => {
      timing = list.getEntries().find((e) => e.name.endsWith(url)) as PerformanceResourceTiming | undefined
      if (timing) (observer.disconnect(), done())
    })
    observer.observe({type: 'resource'})
    setTimeout(() => (observer.disconnect(), done()), 1_000)
  })
  const check = await timed('/api/version', async (signal) => {
    const r = await fetch(url, {signal, cache: 'no-store'})
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    await r.text()
    return 'studio server reached'
  })
  await seen
  return {check, protocol: timing?.nextHopProtocol || null, ttfbMs: timing ? round(timing.responseStart - timing.requestStart) : null}
}

/** An image through the studio's media route (Barkpark's files), from the browser. */
export const mediaCheck = (id: string | null) =>
  id
    ? timed(`/api/media/<image>?size=thumb`, async (signal) => {
        const r = await fetch(`/api/media/${encodeURIComponent(id.replace(/^asset-/, ''))}?size=thumb`, {signal, cache: 'no-store'})
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return `image received (${(await r.blob()).size} bytes)`
      })
    : Promise.resolve<Check>({path: '/api/media/<image>?size=thumb', status: 'success', detail: 'no image to fetch', durationMs: 0, timedOut: false})

export type ListenCheck = {path: string; status: 'success' | 'error'; openMs: number | null; welcomeMs: number | null; durationMs: number; timedOut: boolean}

/** Sanity's listen test: open the studio's live stream, time its open and its welcome event. */
export function listenCheck(type: string): Promise<ListenCheck & {close: () => void}> {
  const path = `/api/listen?types=${type}`
  const t0 = performance.now()
  return new Promise((done) => {
    const es = new EventSource(path)
    let openMs: number | null = null
    const finish = (status: 'success' | 'error', timedOut = false) => {
      clearTimeout(timer)
      done({path, status, openMs, welcomeMs: status === 'success' ? round(performance.now() - t0) : null, durationMs: round(performance.now() - t0), timedOut, close: () => es.close()})
    }
    const timer = setTimeout(() => (es.close(), finish('error', true)), TIMEOUT_MS)
    es.onopen = () => (openMs = round(performance.now() - t0))
    es.addEventListener('welcome', () => finish('success'))
    es.onerror = () => openMs === null && (es.close(), finish('error'))
  })
}

/** The diagnostics as JSON, in Sanity's shape where a field maps (for an issue, or a diff against Sanity's). */
export function diagnosticsJson(d: {
  startedAt: string
  generatedAt: string
  durationMs: number
  studio: Record<string, Json>
  schema: Record<string, Json>
  user: Record<string, Json>
  browser: Record<string, Json>
  network: {protocol: Json; requests: Check[]; listen: {first: ListenCheck | null; secondWhileFirstOpen: ListenCheck | null}}
}) {
  const strip = (l: ListenCheck | null) => (l ? {path: l.path, status: l.status, openMs: l.openMs, welcomeMs: l.welcomeMs, durationMs: l.durationMs, timedOut: l.timedOut} : null)
  return {
    diagnosticVersion: 1,
    startedAt: d.startedAt,
    generatedAt: d.generatedAt,
    durationMs: d.durationMs,
    studio: d.studio,
    schema: d.schema,
    user: d.user,
    browser: d.browser,
    network: {protocol: d.network.protocol, requests: d.network.requests, listen: {first: strip(d.network.listen.first), secondWhileFirstOpen: strip(d.network.listen.secondWhileFirstOpen)}},
  }
}
