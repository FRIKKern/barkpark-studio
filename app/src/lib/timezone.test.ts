import {test} from 'node:test'
import assert from 'node:assert/strict'
import {cityOf, dayKey, zoneLabel, zoneOption} from './timezone.ts'

// task-f8d14f136de4ed6d: Sanity's time zone labels, and the day an instant falls on in a zone.
test('time zone labels and days', () => {
  const at = new Date('2026-10-19T08:00:00Z')
  assert.equal(zoneLabel('Europe/Oslo', at, 'en-US'), 'GMT+2 (Europe/Oslo)')
  assert.equal(zoneLabel('America/New_York', at, 'en-US'), 'EDT (America/New York)')
  // The browser's own names, as Sanity's (task-556f6d421d271155): an en-GB browser reads CEST.
  assert.equal(zoneLabel('Europe/Oslo', at, 'en-GB'), 'CEST (Europe/Oslo)')
  assert.deepEqual(zoneOption('America/New_York', at, 'en-US'), {city: 'New York', offset: 'GMT-4', name: 'Eastern Daylight Time'})
  assert.equal(cityOf('America/Argentina/Buenos_Aires'), 'Buenos Aires')
  // 01:30 UTC on the 19th is still the 18th in New York.
  assert.equal(dayKey(new Date('2026-10-19T01:30:00Z'), 'America/New_York'), '2026-10-18')
  assert.equal(dayKey(new Date('2026-10-19T01:30:00Z'), 'Europe/Oslo'), '2026-10-19')
})
