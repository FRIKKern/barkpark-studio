// The e2e time limits, in one place. CAP_S: CI stops a group's run at this many seconds
// (globalTimeout in e2e/playwright.config.ts; QUALITY.md rule 5, the whole suite fits in 60 s).
// AIM_S: the most seconds any group may plan by e2e/durations.json (scripts/lib/shard-plan.mjs,
// checked in the unit job). A hosted runner runs some 10-15% slower than the durations were
// recorded on now and then (shard 2 hit the cap 3 times in an hour from 50 s planned), so the
// aim leaves that much under the cap: 45 s × 1.15 is about 52 s. Never raised: a group over the
// aim is brought down by time taken out of its specs.
export const CAP_S = 60
export const AIM_S = 45
