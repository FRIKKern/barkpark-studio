// J40: the schedules list as the studio reads it.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readSchedules} from './schedule-read.ts'

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
