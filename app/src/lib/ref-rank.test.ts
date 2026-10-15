// J08: the reference picker's order for a typed search.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {rankRefs} from './ref-rank.ts'

test('rankRefs: best matches first, then by title with numbers in order; no query keeps the server order', () => {
  const docs = ['Fixture post 30', 'Fixture post 2', 'Fixture post 10', 'Ref scout', 'Fixture draft probe'].map((title) => ({title}))
  const order = (q: string) => rankRefs(docs, q, (d) => d.title).map((d) => d.title)
  assert.deepEqual(order('Fixt'), ['Fixture draft probe', 'Fixture post 2', 'Fixture post 10', 'Fixture post 30', 'Ref scout'])
  assert.deepEqual(order('post 1'), ['Fixture post 10', 'Fixture post 2', 'Fixture post 30', 'Fixture draft probe', 'Ref scout'])
  assert.deepEqual(order(''), docs.map((d) => d.title))
})
