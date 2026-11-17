import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Client, Server, leftover, simGate} from './table-sim.ts'

// Review 7's seeds (lib/table-sim.ts simGate): 63018 (#136, a key from the old grid into the other
// editor's saved cell: LOST and DOUBLED on a7fc7a1c) and 96019 (#208, the other editor's first key
// left before my word).

test('two editors, a column or row changed while both type (review 7 seeds): rows even, both agree, every word whole in one cell or on its typer\'s card', () => {
  simGate([63018, 96019], {'INSERT-LEFT-WRONG-SIDE': 1, LEFTOVER: 2})
})

test('a word\'s first keys left before another word, the whole word on its typer\'s card, read as LEFTOVER, not SPLIT', () => {
  // Seed 96019 #208: P's '<' saved, T typed '<U8>' after it as T saw it; P's '<Q8>' is whole on P's card.
  assert.equal(leftover('<<U8>', '<', ['<Q8>']), true)
  // The cell is only the first keys (a column no one could tell): as before.
  assert.equal(leftover('x<', 'x<', ['x<T6>']), true)
  // Keys no kept text begins with, or keys after a word: SPLIT.
  assert.equal(leftover('<<U8>', '<', ['x<Q8>']), false)
  assert.equal(leftover('<U8>Q8>', 'Q8>', ['<Q8>']), false)
})

test('the caret in a removed column that reads like its neighbour does not follow into the neighbour, where the other editor saved a word', () => {
  // The random scenes never reach this (560,000 scenes the same with and without the rule): played by hand.
  const row = (k: string, cells: string[]) => ({_type: 'tableRow', _key: k, cells})
  const server = new Server({_type: 'table', rows: [row('r0', ['x', 'x']), row('r1', ['x', 'x'])]})
  const t = new Client('T', server.doc, [], () => [0, 1])
  const p = new Client('P', server.doc, [], () => [0])
  const save = (c: Client) => {
    c.send()
    const r = c.request!
    c.request = null
    c.answer = server.mutate(r.rev, r.set, r.unset)
    c.onAnswer(server)
  }
  assert.ok(t.click('r0', 1)) // T goes into column 1, types nothing yet
  p.press({kind: 'rmcol', at: 1})
  save(p)
  p.render()
  assert.ok(p.click('r0', 0))
  for (const ch of '<P>') p.key(ch)
  save(p)
  t.applyServer(JSON.parse(JSON.stringify(server.doc)))
  t.render()
  for (const ch of '<T>') t.key(ch)
  if (t.e.dirty.size) save(t)
  assert.deepEqual(server.doc.t.rows.map((r: {cells: string[]}) => r.cells), [['x<P>'], ['x']])
})
