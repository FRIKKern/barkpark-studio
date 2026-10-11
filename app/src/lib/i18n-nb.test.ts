import {test} from 'node:test'
import assert from 'node:assert/strict'
import structure from '../i18n/nb/structure.ts'
import presentation from '../i18n/nb/presentation.ts'

// B01: the navbar's tool names in an nb-NO workspace read as LiveView's (Struktur, not Structure).
test('nb-NO tool names', () => {
  assert.equal(structure.Structure, 'Struktur')
  assert.equal(structure.Media, 'Medier')
  assert.equal(presentation.Presentation, 'Presentasjon')
})
