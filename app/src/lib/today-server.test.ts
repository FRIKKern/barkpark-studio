import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
// Barkpark's own answers are in fixtures/today-cases.json, made by running Barkpark's
// api/lib/barkpark/content/today.ex (scripts/today-cases.exs). The studio must give the same
// date as the server for the same instant and zone.
import {resolveToday} from './today.ts'

type Case = {name: string; now: string; zone: string; value: unknown; server: unknown}
const {cases} = JSON.parse(readFileSync(new URL('../../../fixtures/today-cases.json', import.meta.url), 'utf8')) as {cases: Case[]}

test("a new sak starts with today's date from initialValues $today", () => {
  // 23:30 UTC on 20 November: Oslo (UTC+1) is already on the 21st.
  assert.deepEqual(resolveToday({publisert: '$today', tittel: 'Ny sak'}, new Date('2026-11-20T23:30:00Z'), 'Europe/Oslo'), {publisert: '2026-11-21', tittel: 'Ny sak'})
})

test("the studio gives Barkpark's answer for every $today case (fixtures/today-cases.json)", () => {
  assert.ok(cases.length >= 14)
  for (const c of cases) assert.deepEqual(resolveToday(c.value, new Date(c.now), c.zone), c.server, c.name)
})
