import assert from 'node:assert/strict'
import {test} from 'node:test'
import {tabTitle} from './tab-title.ts'

test('tab title: bidi overrides and isolates in a title never reach the suffix', () => {
  assert.equal(tabTitle('rtl ‮gpj.exe'), 'rtl gpj.exe | Barkpark Studio')
  assert.equal(tabTitle('⁧x⁩ ‪y‬'), 'x y | Barkpark Studio')
  assert.equal(tabTitle('Fixture post 01'), 'Fixture post 01 | Barkpark Studio')
  assert.equal(tabTitle('مرحبا'), 'مرحبا | Barkpark Studio') // right-to-left letters stay
})

test('tab title: a deployment\'s VITE_STUDIO_TITLE names the tab', () => {
  assert.equal(tabTitle('Fixture post 01', 'Pensum Studio'), 'Fixture post 01 | Pensum Studio')
})
