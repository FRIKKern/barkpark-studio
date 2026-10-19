// J40: the schedules list as the studio reads it.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mergeSchedules, readSchedules} from './schedule-read.ts'

const row = (status: string) => ({_id: `s-${status}`, documentId: 'post-01', type: 'post', publishAt: '2026-10-20T08:00:00Z', status})

test('schedules: a Barkpark without the route offers no Schedule; with it, the pending one', () => {
  assert.deepEqual(readSchedules(404, {error: {code: 'not_found'}}), {supported: false, schedule: null})
  assert.deepEqual(readSchedules(200, {result: {schedules: []}}), {supported: true, schedule: null})
  assert.equal(readSchedules(200, {result: {schedules: [row('cancelled'), row('scheduled')]}}).schedule?._id, 's-scheduled')
  // Paused (Pause to edit) counts when nothing is pending; cancelled and finished ones never do.
  assert.equal(readSchedules(200, {result: {schedules: [row('paused'), row('published')]}}).schedule?.status, 'paused')
  assert.equal(readSchedules(200, {result: {schedules: [row('paused'), row('scheduled')]}}).schedule?.status, 'scheduled')
  assert.equal(readSchedules(200, {result: {schedules: [row('cancelled'), row('missed')]}}).schedule, null)
  assert.throws(() => readSchedules(500, null), /Could not read the schedule \(500\)/)
})

test('schedules: the Releases list keeps pending and paused ones when status=all is full', () => {
  const full = Array.from({length: 500}, (_, i) => ({...row('cancelled'), _id: `c-${i}`}))
  const merged = mergeSchedules([row('scheduled')], [row('paused')], [...full, row('scheduled')])
  assert.equal(merged.length, 502)
  assert.deepEqual(merged.slice(0, 2).map((s) => s.status), ['scheduled', 'paused'])
})
