import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {QueryClient} from '@tanstack/react-query'
// Barkpark's own answers are in fixtures/today-cases.json, made by running Barkpark's
// api/lib/barkpark/content/today.ex (scripts/today-cases.exs). The studio must give the same
// date as the server for the same instant and zone, through the one place it resolves.
import {startValues} from './today-start.ts'

type Case = {name: string; now: string; zone: string | null; value: unknown; server: unknown}
const {cases} = JSON.parse(readFileSync(new URL('../../../fixtures/today-cases.json', import.meta.url), 'utf8')) as {cases: Case[]}

const read = {queryKey: ['locale'], queryFn: () => Promise.reject(new Error('the locale is already read'))}

/** What a new document starts with, as the root loader leaves the cache: the workspace's locale, with its zone if it has one. */
function start(zone: string | null, value: unknown, now: Date): unknown {
  const qc = new QueryClient()
  qc.setQueryData(read.queryKey, zone === null ? {locale: 'en'} : {locale: 'en', timeZone: zone})
  let out: unknown
  startValues(qc, read, {schema: value as Record<string, unknown>}, (v) => (out = v), now)
  return out
}

test("a new sak starts with today's date from initialValues $today", () => {
  // 23:30 UTC on 20 November: Oslo (UTC+1) is already on the 21st.
  assert.deepEqual(start('Europe/Oslo', {publisert: '$today', tittel: 'Ny sak'}, new Date('2026-11-20T23:30:00Z')), {publisert: '2026-11-21', tittel: 'Ny sak'})
})

test("the studio gives Barkpark's answer for every $today case (fixtures/today-cases.json)", () => {
  assert.equal(cases.length, 46)
  assert.ok(cases.filter((c) => c.zone === null).length >= 4, 'no-zone rows')
  for (const c of cases) assert.deepEqual(start(c.zone, c.value, new Date(c.now)), c.server, c.name)
})
