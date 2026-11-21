// How CI's e2e groups are planned (scripts/shard-files.mjs prints one group's spec files; the
// unit test scripts/lib/shard-plan.test.mjs holds every group at or under PLAN_LINE_S, written beside
// the 60 s cap in e2e/time-cap.mjs).
import {readdirSync, readFileSync} from 'node:fs'

export {PLAN_LINE_S} from '../../e2e/time-cap.mjs'

const DIR = new URL('../../e2e/journeys/', import.meta.url)
export const DURATIONS = new URL('../../e2e/durations.json', import.meta.url)

/** The spec files CI shards (e2e/journeys/*.spec.ts). */
export const specFiles = () => readdirSync(DIR).filter((f) => f.endsWith('.spec.ts'))

// A spec recorded as 0 s had no CI test then. One with a CI test now (a test whose title names
// none of @local, @evidence, @baseline) counts as unrecorded until it is recorded: counted 0,
// media-library.spec's first CI test (#1061) went to a full shard and ran it past the 60 s cap.
const hasCiTest = (f) => [...readFileSync(new URL(f, DIR), 'utf8').matchAll(/^\s*test\(\s*(['"`])(.*?)\1/gm)].some((m) => !/@local|@evidence|@baseline/.test(m[2]))

/**
 * The plan: `of` groups, each {secs, files}. Heaviest first, each onto the lightest group so far
 * (ties: the lower group, then by name). `unknown`: the specs counted as `median` seconds, not
 * recorded yet (or recorded 0 s with a CI test now); they count as the median recorded spec.
 */
export function plan(of, secs = JSON.parse(readFileSync(DURATIONS, 'utf8')), specs = specFiles(), ciTest = hasCiTest) {
  const ran = Object.values(secs).filter((v) => v > 0).sort((a, b) => a - b)
  const median = ran.length ? ran[Math.floor(ran.length / 2)] : 3
  const timeOf = (f) => (secs[f] === 0 && ciTest(f) ? undefined : secs[f])
  const unknown = specs.filter((f) => timeOf(f) === undefined)
  const groups = Array.from({length: of}, () => ({secs: 0, files: []}))
  for (const f of [...specs].sort((a, b) => (timeOf(b) ?? median) - (timeOf(a) ?? median) || a.localeCompare(b))) {
    const group = groups.reduce((min, g) => (g.secs < min.secs ? g : min))
    group.secs += timeOf(f) ?? median
    group.files.push(`journeys/${f}`)
  }
  return {groups, unknown, median}
}
