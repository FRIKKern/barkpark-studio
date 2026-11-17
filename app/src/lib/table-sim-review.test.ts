import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Client, Server, leftover, simGate} from './table-sim.ts'

// Review 7's seeds (lib/table-sim.ts simGate): 63018 (#136, a key from the old grid into the other
// editor's saved cell: LOST and DOUBLED on a7fc7a1c) and 96019 (#208, the other editor's first key
// left before my word).

test('two editors, a column or row changed while both type (review 7 seeds): rows even, both agree, every word whole in one cell or on its typer\'s card, every key in a cell, on the card or in the input', () => {
  simGate([63018, 96019], {'INSERT-LEFT-WRONG-SIDE': 0, LEFTOVER: 0})
})

test('a word\'s first keys left before another word, the whole word on its typer\'s card, read as LEFTOVER, not SPLIT', () => {
  // Seed 96019 #208: P's '<' saved, T typed '<U8>' after it as T saw it; P's '<Q8>' is whole on P's card.
  assert.equal(leftover('<<U8>', '<', [''], ['<Q8>', '<U8>'], ['<Q8>'], ['<<U8>']), true)
  // Seed 8806 #2854: the same after the cell's own text 'x' (P's 'x<Q' saved, T's '<U4>' after it).
  assert.equal(leftover('x<Q<U4>', 'x<Q', ['x'], ['<Q4>', '<U4>'], ['<Q4>'], ['x<Q<U4>']), true)
  // The cell is only the first keys (a column no one could tell): as before.
  assert.equal(leftover('x<', 'x<', ['x'], ['<T6>'], ['x<T6>'], ['x<']), true)
  // Keys of a word that is in the table too, or of no word on a card, or keys after a word: SPLIT.
  assert.equal(leftover('x<Q<U4>', 'x<Q', ['x'], ['<Q4>', '<U4>'], ['<Q4>'], ['x<Q<U4>', '<Q4>']), false)
  assert.equal(leftover('<Q<U4>', '<Q', [''], ['<Q4>', '<U4>'], [], ['<Q<U4>']), false)
  assert.equal(leftover('<U8>Q8>', 'Q8>', [''], ['<Q8>', '<U8>'], ['<Q8>'], ['<U8>Q8>']), false)
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

// Review 8: a word's first key typed after the live frame of a removal, before the drawing. My row
// reads alike whichever column went, another row says which: the key must not be dropped.
for (const [name, t0] of [['an empty row', [['a', 'b'], ['', '']]], ['an alike row', [['x', 'y'], ['x', 'x']]]] as const)
  test(`${name} under one that says which column went: the first key between the frame and the drawing is kept, the word whole in the table or on the card`, () => {
    const row = (k: string, cells: string[]) => ({_type: 'tableRow', _key: k, cells})
    const server = new Server({_type: 'table', rows: t0.map((cs, i) => row('r' + i, [...cs]))})
    const t = new Client('T', server.doc, [], () => [0, 1])
    const p = new Client('P', server.doc, [], () => [0, 1])
    const save = (c: Client) => {
      c.send()
      const r = c.request!
      c.request = null
      c.answer = server.mutate(r.rev, r.set, r.unset)
      c.onAnswer(server)
    }
    assert.ok(t.click('r1', 1))
    p.press({kind: 'rmcol', at: 0})
    save(p)
    t.applyServer(JSON.parse(JSON.stringify(server.doc))) // the live frame; T's grid not drawn again yet
    t.key('W')
    if (t.e.dirty.size) save(t)
    t.render()
    for (const ch of 'ORD') t.key(ch)
    if (t.e.dirty.size) save(t)
    t.render()
    const stored = server.doc.t.rows.map((r: {cells: string[]}) => r.cells).flat()
    assert.equal(stored.filter((c: string) => c.includes('WORD')).length + t.kept.filter((k) => k.text.includes('WORD')).length, 1, `stored ${JSON.stringify(stored)}, card ${JSON.stringify(t.kept)}`)
  })
