// The e2e time limits, in one place. CAP_S: CI stops a group's run at this many seconds
// (globalTimeout in e2e/playwright.config.ts; QUALITY.md rule 5, the whole suite fits in 60 s).
// PLAN_LINE_S: the most seconds any group may plan by e2e/durations.json (scripts/lib/shard-plan.mjs,
// checked in the unit job). It holds today's plan at seven groups and only ever comes down: a group
// over it is brought down by time taken out of its specs, never by raising it. It says nothing about
// hosted walls, which run several seconds over plan.
export const CAP_S = 60
export const PLAN_LINE_S = 49
