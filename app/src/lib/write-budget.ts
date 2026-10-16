// F4 (a live edit seen by the other browser, task-d22fd88c4694877a): one write per 750 ms
// held the second key of " A" back, seen ~810 ms after typing where the wire takes ~70 ms.
// Now a short edit spends the burst at once (seen in ~165 ms, median of 10) and only long
// typing waits the gap: 8 + 60 000 / 834 = 80 writes in its first minute, 72 after, never
// more than the 75-80 a minute the studio kept before.
export const WRITE_BURST = 8
export const WRITE_GAP_MS = 834

/**
 * This browser's writes to Barkpark, over all documents: `burst` at once, then one per
 * `gapMs`. A short edit goes out at once; long typing settles at one write per `gapMs`,
 * so in any minute it spends at most `burst` + 60 000 / `gapMs`, however many documents
 * are open. A write sent past the budget (a flush on blur, a retry) is owed, up to
 * `burst`, and the next ones wait it out.
 */
export function writeBudget(burst: number, gapMs: number, now = Date.now) {
  let tokens = burst
  let at = now()
  const fill = () => {
    const t = now()
    tokens = Math.min(burst, tokens + (t - at) / gapMs)
    at = t
    return tokens
  }
  return {
    /** ms until a write may go (0: now). */
    wait: () => Math.max(0, (1 - fill()) * gapMs),
    spend: () => void (tokens = Math.max(-burst, fill() - 1)),
  }
}
