// Collapse matrix measured on reference/sanity (2026-10-05): width, pane kinds →
// which panes are strips. Guards the port of Sanity's layout rule.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {collapsed} from './layout.ts'

const T = 'types', L = 'list', D = 'doc'
const rows: [number, string[], string][] = [
  [1000, [T, L, D], 'S..'], [1000, [T, L, D, D], 'SSS.'], [1000, [T, L, D, D, D, D], 'SSSSS.'],
  [1200, [T, L, D], 'S..'], [1200, [T, L, D, D], 'S.S.'], [1200, [T, L, D, D, D], 'S.SS.'], [1200, [T, L, D, D, D, D], 'SSSSS.'],
  [1440, [T, L, D], '...'], [1440, [T, L, D, D], 'SS..'], [1440, [T, L, D, D, D], 'SSS..'], [1440, [T, L, D, D, D, D], 'SSSS..'],
  [1440, [T, L, D, D, D, D, D, D, D], 'SSSSSSSS.'],
  [1700, [T, L, D, D], 'S...'], [1700, [T, L, D, D, D], 'S.S..'], [1700, [T, L, D, D, D, D], 'SSSS..'],
  [2200, [T, L, D, D], '....'], [2200, [T, L, D, D, D], 'S....'], [2200, [T, L, D, D, D, D], 'SSS...'],
]

test('collapses like Sanity', () => {
  for (const [w, kinds, want] of rows) {
    const got = collapsed(kinds as never, w).map((c) => (c ? 'S' : '.')).join('')
    assert.equal(got, want, `${w}px ${kinds.join(',')}`)
  }
})

test('a clicked strip stays open, the rest make room (1440, 9 panes, pane 3)', () => {
  const kinds = [T, L, D, D, D, D, D, D, D] as never
  assert.equal(collapsed(kinds, 1440, 3).map((c) => (c ? 'S' : '.')).join(''), 'SSS.SSSSS')
})

test('an open inspector widens the document, so earlier panes give way (1440, Sanity: 600 + 320)', () => {
  assert.equal(collapsed([T, L, 'docInspect'] as never, 1440).map((c) => (c ? 'S' : '.')).join(''), 'S..')
  assert.equal(collapsed([T, L, 'docInspect'] as never, 1200).map((c) => (c ? 'S' : '.')).join(''), 'SS.')
})
