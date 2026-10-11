// CI's reset step (seed-barkpark.mjs) meets Barkpark redeploys: the old instance stops
// under a request ("other side closed", 20:22 2026-10-09) or the new one's database pool
// is not up yet (500 DBConnection.ConnectionError, 06:52 2026-10-10). Those are asked
// again, with backoff, for about a minute; a write only when sending it twice is harmless.

/** A failure worth asking again: the connection dropped, or Barkpark said so for a moment. */
export function isTransient({status, error, body = ''}) {
  if (error) return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|UND_ERR_SOCKET|UND_ERR_CLOSED|other side closed|socket hang up|fetch failed|terminated/i.test(`${error.code ?? ''} ${error.cause?.code ?? ''} ${error.message ?? ''} ${error.cause?.message ?? ''}`)
  if (status === 502 || status === 503 || status === 504) return true
  return status === 500 && /DBConnection|ConnectionError|connection (?:not available|closed|refused)|Retry shortly/i.test(body)
}

// Writes that land the same however often they are sent. A patch is only when it sets
// or unsets (inc, insert and diffMatchPatch add each time); create fails the second time.
const SAME_TWICE = new Set(['createOrReplace', 'delete', 'publish', 'unpublish', 'discardDraft'])
/** Whether a mutate batch may be sent again after an answer that never came. */
export function idempotent(mutations) {
  return mutations.every((m) => {
    const [kind, op] = Object.entries(m ?? {})[0] ?? []
    if (SAME_TWICE.has(kind)) return true
    return kind === 'patch' && Object.keys(op ?? {}).every((k) => ['id', 'type', 'set', 'unset', 'ifRevisionID'].includes(k))
  })
}

/** 1 s, 2 s, 4 s, 8 s, then 15 s apart, until `budgetMs` is spent. */
export const backoff = (attempt) => Math.min(1000 * 2 ** attempt, 15_000)

/**
 * `send()` (a fetch) again while it fails transiently and `budgetMs` lasts, logging each
 * retry. Not `safe` (a write that may not repeat): returned (or thrown) as it came.
 */
export async function withRetry(send, {label, safe = true, budgetMs = 60_000, log = console.warn, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now} = {}) {
  const started = now()
  for (let attempt = 0; ; attempt++) {
    let res, error, body
    try {
      res = await send()
      if (res.ok || !safe || ![500, 502, 503, 504].includes(res.status)) return res
      body = await res.clone().text().catch(() => '')
    } catch (err) {
      error = err
      if (!safe) throw err
    }
    const why = error ? (error.cause?.code ?? error.cause?.message ?? error.message) : `${res.status} ${body.slice(0, 120)}`
    const wait = backoff(attempt)
    if (!isTransient({status: res?.status, error, body}) || now() - started + wait > budgetMs) {
      if (error) throw error
      return res
    }
    log(`[retry] ${label}: ${why}; again in ${wait / 1000} s (attempt ${attempt + 2})`)
    await sleep(wait)
  }
}
