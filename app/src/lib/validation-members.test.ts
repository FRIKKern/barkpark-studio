// task-be64491431695cfe: a page builder (an array whose `of` lists several members, HSO's
// innhold, hovinbyen-ny blokker.ts:198-204) has each item checked under the member its _type
// names, with the rules a one-member array's items get. Both Publish doors ask publishErrors.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {errorsOf, validate} from './validation.ts'
import {heldReason, publishErrors} from './publish-check.ts'
import {known} from './persons.fixture.ts'
import type {WidthOf} from './image-min-width.ts'

const widthOf: WidthOf = (ref) => ({'image-small': {width: 800, mimeType: 'image/jpeg'}, 'image-wide': {width: 1600, mimeType: 'image/jpeg'}})[ref]
const img = (key: string, ref: string) => ({_key: key, _type: 'image', asset: {_type: 'reference', _ref: ref}})
const schema = {
  name: 'side',
  title: 'Side',
  fields: [
    {name: 'tittel', title: 'Tittel', type: 'string'},
    {name: 'innhold', title: 'Innhold', type: 'arrayOf', of: [
      {name: 'bildeblokk', title: 'Bilde', type: 'composite', namedType: 'bildeblokk', fields: [{name: 'bilder', title: 'Bilder', type: 'arrayOf', of: {name: 'bildeMedAlt', type: 'image', options: {minWidth: 1200}}}]},
      {name: 'sitat', title: 'Sitat', type: 'composite', namedType: 'sitat', fields: [{name: 'tekst', title: 'Tekst', type: 'text', validation: {required: true}}, {name: 'kilde', title: 'Kilde', type: 'string', validation: {max: 5}}]},
    ]},
  ],
} as never
const doc = (innhold: unknown[]) => ({_id: 's', _publishedId: 's', _type: 'side', _draft: true, _rev: 'r', _updatedAt: '', tittel: 'T', innhold}) as never

test("a page builder's items are checked under their own member: the gallery's minWidth warns, an empty required text holds Publish in both doors", async () => {
  const items = [
    {_key: 'b', _type: 'bildeblokk', bilder: [img('i1', 'image-wide'), img('i2', 'image-small')]},
    {_key: 's', _type: 'sitat', tekst: '', kilde: 'for lang'},
  ]
  const found = validate(doc(items), schema, undefined, undefined, undefined, widthOf)
  assert.deepEqual(found.map((p) => [p.level, p.path, p.parents, p.title, p.message]), [
    ['warning', 'innhold[_key=="b"].bilder[_key=="i2"]', ['Innhold', 'Bilde'], 'Bilder', 'The image is under 1200 pixels wide. It may look blurry.'],
    ['error', 'innhold[_key=="s"].tekst', ['Innhold', 'Sitat'], 'Tekst', 'Required'],
    ['error', 'innhold[_key=="s"].kilde', ['Innhold', 'Sitat'], 'Kilde', 'Must be at most 5 characters long'],
  ])
  // The pane's Publish and Publish selected ask publishErrors: the errors hold, the warning never does.
  const held = await publishErrors(doc(items), schema, known('editor'), undefined, {widthOf})
  assert.deepEqual(held.map(heldReason), ['Innhold / Sitat / Tekst: Required', 'Innhold / Sitat / Kilde: Must be at most 5 characters long'])
  assert.deepEqual(errorsOf(validate(doc([items[0]!]), schema, undefined, undefined, undefined, widthOf)), [])
})

test('an item no member names, a non-object item or a member-less array is not judged, and nothing throws', () => {
  const odd = [{_key: 'x', _type: 'ukjent', tekst: ''}, {_key: 'y'}, 'tekst', null, 7]
  assert.deepEqual(validate(doc(odd), schema, undefined, undefined, undefined, widthOf), [])
  const empty = {...(schema as {fields: unknown[]}), fields: [{name: 'innhold', title: 'Innhold', type: 'arrayOf', of: []}]} as never
  assert.deepEqual(validate(doc([{_key: 's', _type: 'sitat', tekst: ''}]), empty), [])
})
