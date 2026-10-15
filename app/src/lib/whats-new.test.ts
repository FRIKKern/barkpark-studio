import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseChanges} from './whats-new.ts'

test("What's new: merged PRs from the build's git log, newest first, without housekeeping", () => {
  const log = [
    '2026-10-15\tScope switch keeps the open panes that exist there (#625)',
    '2026-10-15\tchore: refresh README timeline and roadmap [skip ci]',
    '2026-10-15\tfeat(comments): inline comments show on the read-only body too (J40) (#624)',
    '2026-10-14\tMerge abc into def',
    '2026-10-14\tfix!: a commit with no PR number',
    '',
  ].join('\n')
  assert.deepEqual(parseChanges(log), [
    {date: '2026-10-15', title: 'Scope switch keeps the open panes that exist there', pr: 625},
    {date: '2026-10-15', title: 'Comments: inline comments show on the read-only body too (J40)', pr: 624},
  ])
  assert.equal(parseChanges(log, 1).length, 1)
})
