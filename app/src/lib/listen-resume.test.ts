// task-fe195c533c697cdb: live-hub.spec 'the upstream cut mid-write' failed on CI when the
// resumed stream ended right after Barkpark's welcome. The welcome (its newest id) had moved
// the hub's resume point past the frames it was about to replay, so the next attempt asked
// for nothing and the write in the gap never came.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {resumeAt} from './listen-resume.ts'

// The hub's frames in order, as dispatch() sees them.
const run = (held: string | null, frames: [event: string, id: string | null][]) => frames.reduce((at, [event, id]) => resumeAt(at, event, id), held)

test('a resume cut between the welcome and its replay asks again from where it was', () => {
  // Heard up to 100; writes 101-103 land while the stream is down. The next stream welcomes
  // at 103 and ends before replaying them: the attempt after must still send 100.
  assert.equal(run('100', [['welcome', '103']]), '100')
  // The replay that does come moves it on frame by frame.
  assert.equal(run('100', [['welcome', '103'], ['mutation', '101'], ['mutation', '102']]), '102')
  assert.equal(run('100', [['welcome', '103'], ['mutation', '101'], ['mutation', '102'], ['mutation', '103']]), '103')
})

test('a first stream starts at the welcome, so a cut before any write still has a place to resume', () => {
  assert.equal(run(null, [['welcome', '57']]), '57')
  assert.equal(run(null, [['welcome', null]]), null) // an empty log: nothing to resume at yet
})

test('a welcome below the held id (the log started over) is taken', () => {
  assert.equal(run('900', [['welcome', '12']]), '12')
})

test('frames without an id leave it as it was', () => {
  assert.equal(run('100', [['ping', null], ['disconnect', null]]), '100')
})
