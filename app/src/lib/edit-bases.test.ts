import {test} from 'node:test'
import assert from 'node:assert/strict'
import {answered, rebase, takeBase, type Spots} from './edit-bases.ts'
import {applyPaths, getPath, setInside, setPath, within} from './paths.ts'

// lib/edits.ts's save queue, its base-and-dirty part (edit, send, answer, a frame), on one document.
type Doc = {_id: string; _rev: string; _updatedAt: string; t: {_type: 'table'; rows: {_type: 'tableRow'; _key: string; cells: string[]}[]}}
const row = (_key: string, ...cells: string[]) => ({_type: 'tableRow' as const, _key, cells})
const doc = (rev: number, ...rows: ReturnType<typeof row>[]): Doc => ({_id: 'd', _rev: `v${rev}`, _updatedAt: `2026-11-16T00:00:0${rev}Z`, t: {_type: 'table', rows}})
const CELLS = 't.rows[_key=="r1"].cells'

function editor(start: Doc) {
  const e: Spots = {base: new Map(), dirty: new Map(), inflight: null}
  let cache: Doc = structuredClone(start)
  const edit = (field: string, value: unknown) => {
    takeBase(e, field, cache, value)
    const outer = [...e.dirty.keys()].find((k) => k !== field && within(field, k))
    if (outer) e.dirty.set(outer, setInside(outer, e.dirty.get(outer), field, value))
    else e.dirty.set(field, value)
    cache = setPath({...cache} as never, field, value) as Doc
  }
  const overlay = (d: Doc) => applyPaths(applyPaths(d as never, e.inflight ?? []), e.dirty) as Doc
  const frame = (d: Doc) => (rebase(e, d as never, cache as never), (cache = overlay(d)))
  return {
    e,
    get cache() {
      return cache
    },
    edit,
    send: () => ((e.inflight = e.dirty), (e.dirty = new Map())),
    answer: (saved: Doc) => (answered(e, saved), (e.inflight = null), frame(saved)),
    frame,
    type: (text: string) => edit(CELLS, (getPath(cache, CELLS) as string[]).map((c, i) => (i === 2 ? text : c))),
  }
}

// The round-4 review (failed on c7a41471): A inserts a column and types into it at once while B
// types elsewhere. A's rows write is on its way when the first keys land; when it is answered,
// the cells A typed in are pending with no base of their own. The next key took one from A's
// copy, A's own unsent letters in it, and B's next frame read them as removed.
test('a cell typed in while its rows were on their way keeps every letter after the answer and another editor\'s frame', () => {
  const start = doc(1, row('r0', 'S', 'M'), row('r1', '', ''))
  const a = editor(start)
  a.edit('t.rows', [row('r0', 'S', 'M', ''), row('r1', '', '', '')])
  a.send()
  a.type('ab')
  const saved = doc(2, row('r0', 'S', 'M', ''), row('r1', '', '', ''))
  a.answer(saved)
  assert.equal(a.e.base.get(CELLS)?.toString(), ',,', 'the answer is the typed cells\' base')
  a.type('abc')
  // B typed in another cell meanwhile.
  a.frame(doc(3, row('r0', 'S by B', 'M', ''), row('r1', '', '', '')))
  assert.deepEqual(a.cache.t.rows.map((r) => r.cells), [['S by B', 'M', ''], ['', '', 'abc']])
})
