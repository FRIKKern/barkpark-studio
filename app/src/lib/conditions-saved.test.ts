import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fieldState} from './conditions.ts'
import {known} from './persons.fixture.ts'

// T8 (task-1106101a01d6ddd1): a field that locks once the document is saved, HSO's omrade.farge.
// Sanity's `readOnly: ({document}) => Boolean(document?._createdAt)` (hovinbyen-ny
// src/sanity/schema/dokumenter/taksonomi.ts:30) and HSO's Barkpark form of it
// (`{field: "farge", operator: "non_empty"}`, src/innholdsmodell/typer/taksonomi.ts:32).
// Both pass on main since T3: this pins them. Barkpark's envelope carries `_createdAt` on a
// saved document; a new one (edits.ts draftNew) has none until its first save lands.
const editor = known('editor')
const readOnly = (f: object, doc: Record<string, unknown>) => fieldState('omrade', f as never, doc, editor, undefined).readOnly

test('farge is read-only on a saved omrade, editable on a new one', () => {
  const saved = {_id: 'drafts.o', _createdAt: '2026-11-21T10:00:00Z', farge: 'gronn'}
  const fresh = {_id: 'drafts.n', _createdAt: undefined, _updatedAt: '', farge: undefined}
  const byCreated = {name: 'farge', type: 'select', options: ['gronn'], readOnly: {field: '_createdAt', operator: 'non_empty'}}
  const byValue = {name: 'farge', type: 'select', options: ['gronn'], readOnly: {field: 'farge', operator: 'non_empty'}}
  for (const f of [byCreated, byValue]) {
    assert.equal(readOnly(f, saved), true, `saved: ${JSON.stringify(f.readOnly)}`)
    assert.equal(readOnly(f, fresh), false, `new: ${JSON.stringify(f.readOnly)}`)
  }
  // The task's form stays open while a new document's farge is picked; HSO's locks on the pick.
  assert.equal(readOnly(byCreated, {...fresh, farge: 'gronn'}), false)
  assert.equal(readOnly(byValue, {...fresh, farge: 'gronn'}), true)
})

test("a new document's cache copy has no _createdAt until Barkpark's answer", () => {
  const edits = readFileSync(new URL('./edits.ts', import.meta.url), 'utf8')
  const fresh = edits.match(/\{_id: `drafts\.\$\{id\}`, _publishedId: id, _type: [^}]*\}/g) ?? []
  assert.ok(fresh.length >= 2, 'draftNew and createNow')
  for (const doc of fresh) assert.doesNotMatch(doc, /_createdAt/)
})
