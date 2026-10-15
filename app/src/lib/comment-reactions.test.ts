import {test} from 'node:test'
import assert from 'node:assert/strict'

test("J40 widen: Sanity's reactions toggle per person and group in its order", async () => {
  const {toggleReaction, reactionGroups} = await import('./comment-threads.ts')
  let r = toggleReaction([], ':eyes:', 'a@x', 't1')
  r = toggleReaction(r, ':+1:', 'b@x', 't2')
  r = toggleReaction(r, ':eyes:', 'b@x', 't3')
  assert.deepEqual(reactionGroups(r).map((g) => [g.emoji, g.users]), [['👍', ['b@x']], ['👀', ['a@x', 'b@x']]])
  r = toggleReaction(r, ':eyes:', 'a@x', 't4') // a takes theirs back
  assert.deepEqual(reactionGroups(r).map((g) => [g.shortName, g.users.length]), [[':+1:', 1], [':eyes:', 1]])
})
