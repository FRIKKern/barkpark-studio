import {test} from 'node:test'
import assert from 'node:assert/strict'

// Two tabs of one editor share one localStorage: a keep or a Dismiss in one must not wipe the
// other's kept text (lib/table-kept.ts). The other tab is played by writing storage directly.

const store = new Map<string, string>()
;(globalThis as {localStorage?: unknown}).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size
  },
}
const {dropKept, keepTyped, setTableKeptScope, takeTableKept} = await import('./table-kept.ts')

const KEY = 'bp-table-kept:s1|doc1'
const entry = (id: string, text: string, row = 'r1') => ({table: 't', row, column: 0, text, at: 1, id})
const stored = () => (JSON.parse(store.get(KEY) ?? '[]') as {text: string}[]).map((k) => k.text).sort()

test('two tabs: a keep in each, and a Dismiss in one, leave the other tab\'s kept text', () => {
  setTableKeptScope('s1')
  takeTableKept('doc1', {kept: [{table: 't', row: 'r1', column: 0, text: 'from tab one', at: 1}]})
  // Tab two keeps its own text meanwhile (its own write of the whole list).
  store.set(KEY, JSON.stringify([...JSON.parse(store.get(KEY)!), entry('two', 'from tab two', 'r2')]))
  keepTyped('doc1', {table: 't', row: 'r3', column: 1, text: 'tab one again', at: 2})
  assert.deepEqual(stored(), ['from tab one', 'from tab two', 'tab one again'])
  // Tab two adds one more, then tab one dismisses its own first text.
  store.set(KEY, JSON.stringify([...JSON.parse(store.get(KEY)!), entry('three', 'tab two later', 'r4')]))
  const mine = (JSON.parse(store.get(KEY)!) as {id: string; text: string}[]).find((k) => k.text === 'from tab one')!.id
  dropKept('doc1', mine)
  assert.deepEqual(stored(), ['from tab two', 'tab one again', 'tab two later'])
})
