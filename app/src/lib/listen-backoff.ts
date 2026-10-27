// How long the server's listen hub (server/listen.ts) waits before it opens Barkpark's
// stream again, and whether live updates are paused (task-d996dafa8231ba46).
//
// A stream that lived reconnects in 500 ms. A request that fails waits 500 ms, doubling to
// 10 s (a dead token: a minute), as before. A refusal, Barkpark's `event: disconnect` (its
// stream cap, Barkpark #24282), and a 200 that ends at once are not blips: they back off from
// 1 s, doubling to 60 s, with a fifth of jitter either way so a server's hubs don't come
// back in step. A refusal pauses live updates at once, with Barkpark's reason; quick ends
// pause after a few in a row. The pages say so until a stream welcomes again.
//
// A refresh is none of these: the hub cut the stream itself (a new Barkpark boot after a
// blue/green flip, a write with no echo, a silent minute, the e2e `cut` and `flip` levers)
// and reopens at once, counting nothing. A flip's old instance ends a stream that lived
// (`event: retire`), and new streams go to the new one: at most one quick end, never a
// pause.

export type Attempt = {ok: boolean; status?: number; refusal?: string | null; livedMs: number; refreshed?: boolean}
export type Backoff = {delay: number; quickEnds: number; paused: string | null}

/** A 200 that ends sooner than this was not a stream. */
export const QUICK_MS = 1000
/** Quick ends in a row before live updates count as paused. */
export const PAUSE_AFTER = 3

const SOON = 500
const MAX_FAILED = 10_000
const MAX_REFUSED = 60_000
const DEAD_TOKEN = 60_000

export const initialBackoff = (): Backoff => ({delay: SOON, quickEnds: 0, paused: null})

/** The state after an attempt, and how long to wait before the next. */
export function afterAttempt(s: Backoff, a: Attempt, random: () => number = Math.random): {state: Backoff; wait: number} {
  if (a.refreshed) return {state: s, wait: 0}
  if (a.ok && !a.refusal && a.livedMs >= QUICK_MS) return {state: initialBackoff(), wait: SOON}
  if (a.ok) {
    const quickEnds = s.quickEnds + 1
    const delay = s.quickEnds === 0 ? 1000 : Math.min(s.delay * 2, MAX_REFUSED)
    const paused = a.refusal || (quickEnds >= PAUSE_AFTER ? 'Barkpark keeps closing the live stream' : s.paused)
    return {state: {delay, quickEnds, paused}, wait: Math.round(delay * (0.8 + 0.4 * random()))}
  }
  if (a.status === 401) return {state: {...s, delay: DEAD_TOKEN}, wait: DEAD_TOKEN}
  return {state: {...s, delay: Math.min(s.delay * 2, MAX_FAILED)}, wait: s.delay}
}
