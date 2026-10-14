// J40: the schedules list as the studio reads it.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {localInput, readSchedules} from './schedule-read.ts'

const row = (status: string) => ({_id: `s-${status}`, documentId: 'post-01', type: 'post', publishAt: '2026-10-20T08:00:00Z', status})

test('schedules: a Barkpark without the route offers no Schedule; with it, the pending one', () => {
  assert.deepEqual(readSchedules(404, {error: {code: 'not_found'}}), {supported: false, schedule: null})
  assert.deepEqual(readSchedules(200, {result: {schedules: []}}), {supported: true, schedule: null})
  assert.equal(readSchedules(200, {result: {schedules: [row('cancelled'), row('scheduled')]}}).schedule?._id, 's-scheduled')
  assert.throws(() => readSchedules(500, null), /Could not read the schedule \(500\)/)
  assert.match(localInput(new Date()), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
})
