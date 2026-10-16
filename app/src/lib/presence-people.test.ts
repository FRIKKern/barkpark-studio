// J07: presence per person, and Sanity's avatar stack overflow.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {people, stack, withoutSelf} from './presence-people.ts'

const s = (sessionId: string, name: string, documentId: string | null = null, field: string | null = null) => ({sessionId, name, color: `c-${sessionId}`, documentId, field})

test('one person per name, in the first session colour, at the place they moved to last', () => {
  const all = [s('1', 'Ada', 'post-01', 'title'), s('2', 'Grace'), s('3', 'Ada', 'post-02', 'excerpt')]
  const seen = new Map([['1', 10], ['3', 20]])
  assert.deepEqual(people(all, seen).map((p) => [p.name, p.color, p.documentId, p.field, p.sessions]), [
    ['Ada', 'c-1', 'post-02', 'excerpt', 2],
    ['Grace', 'c-2', null, null, 1],
  ])
  // A later move to no document still shows the last document the person is in.
  assert.equal(people([s('1', 'Ada', 'post-01'), s('3', 'Ada')], new Map([['3', 30]]))[0]!.documentId, 'post-01')
})

test('signed in, your own tabs are left out; shared sign-in leaves everyone in', () => {
  const all = [s('1', 'ada'), s('2', 'grace'), s('3', 'ada')]
  assert.deepEqual(withoutSelf(all, 'ada').map((p) => p.sessionId), ['2'])
  assert.deepEqual(withoutSelf(all, null).map((p) => p.sessionId), ['1', '2', '3'])
})

test('the stack shows up to max, then max - 1 and a counter of the rest (never a counter of 1)', () => {
  const n = (k: number) => Array.from({length: k}, (_, i) => i + 1)
  assert.deepEqual(stack(n(3), 3), {hidden: 0, shown: [1, 2, 3]})
  assert.deepEqual(stack(n(4), 3), {hidden: 2, shown: [3, 4]})
  assert.deepEqual(stack(n(7), 3), {hidden: 5, shown: [6, 7]})
  assert.deepEqual(stack(n(2), 2), {hidden: 0, shown: [1, 2]})
  assert.deepEqual(stack(n(3), 2), {hidden: 2, shown: [3]})
})
