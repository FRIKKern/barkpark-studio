import {test} from 'node:test'
import assert from 'node:assert/strict'
import {arrayDiff} from './array-diff.ts'

const kinds = (d: {item: unknown; kind: string}[]) => d.map((x) => `${typeof x.item === 'object' ? (x.item as {_key: string})._key : x.item}:${x.kind}`)

test('review changes: array items added, removed and moved, by _key or by value', () => {
  assert.deepEqual(kinds(arrayDiff(['one', 'two', 'three'], ['three', 'one', 'four'])), ['three:kept', 'one:moved', 'four:added', 'two:removed'])
  const r = (k: string) => ({_key: k, _ref: `ref-${k}`})
  assert.deepEqual(kinds(arrayDiff([r('c1'), r('c2')], [r('c2'), r('c3')])), ['c2:kept', 'c3:added', 'c1:removed'])
  assert.deepEqual(kinds(arrayDiff(['a', 'a'], ['a'])), ['a:kept', 'a:removed'])
  assert.deepEqual(arrayDiff([], []), [])
})
