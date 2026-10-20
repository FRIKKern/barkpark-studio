import {test} from 'node:test'
import assert from 'node:assert/strict'
import structure from '../i18n/nb/structure.ts'
import presentation from '../i18n/nb/presentation.ts'
import fields from '../i18n/nb/fields.ts'

// B01: the navbar's tool names in an nb-NO workspace read as LiveView's (Struktur, not Structure).
test('nb-NO tool names', () => {
  assert.equal(structure.Structure, 'Struktur')
  assert.equal(structure.Media, 'Medier')
  assert.equal(presentation.Presentation, 'Presentasjon')
})

// One English text, two Norwegian ones (Sanity's): a key's context before \u0004 is never shown.
test('nb-NO: the change bar says Se endringer, the History tab Gjennomgå endringer', () => {
  assert.equal(fields['change bar\u0004Review changes'], 'Se endringer')
  assert.equal(fields['Review changes'], 'Gjennomgå endringer')
})

// The date picker reads as Sanity's calendar: capital month names, three-letter days without a dot.
test("nb-NO: the date picker's month and day names are Sanity's", () => {
  assert.equal(fields['calendar month\u0004March'], 'Mars')
  assert.equal(fields['calendar month\u0004December'], 'Desember')
  assert.equal(fields['calendar day\u0004Mon'], 'Man')
  assert.equal(fields['calendar day\u0004Sun'], 'Søn')
})
