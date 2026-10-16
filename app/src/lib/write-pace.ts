// How often this browser may write while Barkpark's write budget is running out. In
// shared mode every editor of a studio writes as one Barkpark token (180 writes a minute),
// and five editors typing asked for twice that: Barkpark answered 429, each write waited
// out up to three Retry-Afters, and words reached the others a minute late (task-86f75846c256e3b4).
// A write answered while the token met a 429 in the last few seconds (any tab's: server/
// barkpark.ts underPressure) doubles the gap between this browser's writes (fields and
// canvas alike, up to MAX_MS); each clean write takes a fifth off. More keystrokes ride each write,
// none is lost, and the room's writes settle under the budget. Untouched, the gap is 0.

const MAX_MS = 4_000
let pace = 0

/** The least time between two writes of this browser now (ms; 0 when nothing was throttled). */
export const paceMs = () => pace

/** A write's answer: `throttled` when it met a 429 on its way. */
export function paced(throttled: boolean) {
  pace = throttled ? Math.min(MAX_MS, Math.max(500, pace * 2)) : pace * 0.8 < 100 ? 0 : pace * 0.8
}
