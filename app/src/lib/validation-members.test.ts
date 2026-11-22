// task-be64491431695cfe: a page builder (an array whose `of` lists several members, HSO's
// innhold, hovinbyen-ny blokker.ts:198-204) has each item checked under the member its _type
// names, with the rules a one-member array's items get. Both Publish doors ask publishErrors.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {errorsOf, validate} from './validation.ts'
import {heldReason, publishErrors} from './publish-check.ts'
import {advisoryProblems, keyedAt, type Finding} from './findings.ts'
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


test("after a save, Barkpark's finding on a page-builder item is the Studio's own problem: shown once; one the Studio has no rule for shows once too", () => {
  // review-57's case (#1379): Barkpark answers an ADVISE save with findings at index paths.
  const items = [{_key: 't', _type: 'bildeblokk', bilder: []}, {_key: 's', _type: 'sitat', tekst: ''}, {_key: 'x', _type: 'ukjent'}]
  const raw: Finding[] = [
    {path: '/innhold/1/tekst', code: 'required', message: 'Required'},
    {path: '/innhold/2', code: 'unknown_type', message: 'unknown _type "ukjent"', params: {type_name: 'ukjent'}},
  ]
  const own = validate(doc(items), schema)
  const extra = advisoryProblems(keyedAt(raw, doc(items)), schema, own, (en: string, v: Record<string, unknown> = {}) => en.replace(/\{(\w+)\}/g, (_, k) => String(v[k])))
  assert.deepEqual([...own, ...extra].map((p) => [p.path, p.message]), [
    ['innhold[_key=="s"].tekst', 'Required'],
    ['innhold[_key=="x"]', 'Unknown item type "ukjent"'],
  ])
})

test('a rich-text block finding arrives keyed too, and still shows on the text field under its block (Body / Callout / Tone)', () => {
  const text = {name: 'post', title: 'Post', fields: [{name: 'body', title: 'Body', type: 'richText', blocks: {of: [{name: 'callout', title: 'Callout', fields: [{name: 'tone', title: 'Tone', type: 'string', validation: {required: true}}]}]}}]} as never
  const saved = {body: [{_key: 'p', _type: 'block'}, {_key: 'c', _type: 'callout'}]}
  const keyed = keyedAt([{path: '/body/1/tone', code: 'required', message: 'Required'}], saved)
  assert.equal(keyed[0]!.at, 'body[_key=="c"].tone')
  const [p] = advisoryProblems(keyed, text, [], (en) => en)
  assert.deepEqual([p!.path, p!.parents, p!.title, p!.level], ['body', ['Body', 'Callout'], 'Tone', 'error'])
})

// One member (`of` a single field): every problem as on main c7ab09c5 (the table's answers are
// main's, read there), so only a page builder's items are newly judged.
const one = {
  name: 'side',
  title: 'Side',
  fields: [
    {name: 'lenker', title: 'Lenker', type: 'arrayOf', of: {name: 'lenke', title: 'Lenke', type: 'composite', options: {typeField: 'kind', fieldsByType: {ekstern: ['kind', 'url'], intern: ['kind']}}, fields: [
      {name: 'kind', title: 'Kind', type: 'string', options: [{value: 'ekstern', title: 'Ekstern lenke'}, {value: 'intern', title: 'Intern'}]},
      {name: 'url', title: 'URL', type: 'url', validation: {required: true}},
      {name: 'tekst', title: 'Tekst', type: 'string', validation: {max: 3}},
    ]}},
    {name: 'kort', title: 'Kort', type: 'arrayOf', of: {name: 'kortet', type: 'composite', fields: [{name: 'tekst', title: 'Kort tekst', type: 'text', validation: {max: 5}}, {name: 'bilde', title: 'Bilde', type: 'image', options: {minWidth: 1200}}]}},
    {name: 'adresser', title: 'Adresser', type: 'arrayOf', of: {name: 'adresse', type: 'url'}},
    {name: 'bilder', title: 'Bilder', type: 'arrayOf', of: {name: 'bildeMedAlt', type: 'image', options: {minWidth: 1200}}},
    {name: 'refs', title: 'Refs', type: 'arrayOf', of: {name: 'ref', type: 'reference'}},
  ],
} as never
const oneDoc = {
  lenker: [{_key: 'a', kind: 'ekstern', url: '', tekst: 'lang'}, {_key: 'b', kind: 'intern', url: '', tekst: 'lang'}, 'tekst', null],
  kort: [{_key: 'k1', tekst: 'for lang', bilde: img('i', 'image-small')}, {_key: 'k2', tekst: 'kort'}],
  adresser: ['ftp://x', 'https://ok.no'],
  bilder: [img('b1', 'image-small'), img('b2', 'image-wide')],
  refs: [{_key: 'r1'}, {_key: 'r2', _type: 'reference', _ref: 'd'}],
}
const mains: [string, string, string[] | undefined, string, string][] = [
  ['error', 'lenker[_key=="a"].url', ['Lenker', 'Ekstern lenke'], 'URL', 'Required'],
  ['error', 'kort[_key=="k1"].tekst', ['Kort'], 'Kort tekst', 'Must be at most 5 characters long'],
  ['warning', 'kort[_key=="k1"].bilde', ['Kort'], 'Bilde', 'The image is under 1200 pixels wide. It may look blurry.'],
  ['error', 'adresser[0]', undefined, 'Adresser', 'Does not match allowed protocols/schemes'],
  ['warning', 'bilder[_key=="b1"]', undefined, 'Bilder', 'The image is under 1200 pixels wide. It may look blurry.'],
  ['error', 'refs[_key=="r1"]', undefined, 'Refs', 'Must be a reference to a document'],
]

test('one member: every array case answers as on main (fields by kind, nested image, plain items, images, empty reference rows)', () => {
  const got = validate({...(doc([]) as object), ...oneDoc} as never, one, undefined, undefined, undefined, widthOf)
  assert.deepEqual(got.map((p) => [p.level, p.path, p.parents, p.title, p.message]), mains)
})
