// T7 (task-e1c90cb700ed5d62): options.minWidth on an image, HSO's Sanity rule (bildeMedAlt.ts):
// a warning when the picked image is narrower, never blocking, nothing without a known width.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import {validate, errorsOf} from './validation.ts'
import type {WidthOf} from './image-min-width.ts'

const HSO = 'Bildet er lite (under 1200 piksler bredt). Det kan bli uskarpt i toppen av siden.'
const img = (ref: string) => ({_type: 'image', asset: {_type: 'reference', _ref: ref}, alt: 'Et bilde'})
const assets: Record<string, {width?: number; mimeType?: string}> = {
  'image-small': {width: 800, mimeType: 'image/jpeg'},
  'image-wide': {width: 1200, mimeType: 'image/jpeg'},
  'image-nowidth': {mimeType: 'image/jpeg'},
  'image-zero': {width: 0, mimeType: 'image/jpeg'},
  'image-vector': {width: 300, mimeType: 'image/svg+xml'},
  // A Sanity id as the info read gives it: its size from the id itself.
  [`image-${'a'.repeat(40)}-640x480-jpg`]: {width: 640, mimeType: 'image/jpeg'},
  [`image-${'b'.repeat(40)}-300x300-svg`]: {width: 300},
}
const widthOf: WidthOf = (ref) => assets[ref]
const opts = {minWidth: 1200, minWidthMessage: HSO, hotspot: true}
const schema = {
  name: 'side',
  title: 'Side',
  fields: [
    {name: 'hovedbilde', title: 'Hovedbilde', type: 'image', options: opts},
    {name: 'bilde', title: 'Bilde', type: 'image', options: {minWidth: 1200}, validation: {required: true, message: 'Legg inn et bilde'}},
    {name: 'bilder', title: 'Bilder', type: 'arrayOf', of: {name: 'bildeMedAlt', type: 'image', options: opts}},
    {name: 'blokk', title: 'Blokk', type: 'composite', fields: [{name: 'bilde', title: 'Bilde', type: 'image', options: opts}]},
    {name: 'kort', title: 'Kort', type: 'arrayOf', of: {name: 'kortet', type: 'composite', fields: [{name: 'bilde', title: 'Bilde', type: 'image', options: opts}]}},
    {name: 'fil', title: 'Fil', type: 'file', options: {minWidth: 1200}},
    {name: 'fritt', title: 'Fritt', type: 'image'},
    // HSO's body text (blokker.ts): a «Bilde» block holding a gallery, and one other rule in a block.
    {name: 'innhold', title: 'Innhold', type: 'richText', blocks: {of: [
      {name: 'bildeblokk', title: 'Bilde', fields: [{name: 'bilder', title: 'Bilder', type: 'arrayOf', of: {name: 'bildeMedAlt', type: 'image', options: opts}}, {name: 'stort', title: 'Stort bilde', type: 'image', options: {minWidth: 1200}}]},
      {name: 'faktaboks', title: 'Faktaboks', fields: [{name: 'tittel', title: 'Tittel', type: 'string', validation: {required: true}}, {name: 'lenke', title: 'Lenke', type: 'url'}]},
      // An image inside an object inside a block, and an image block of its own.
      {name: 'kortblokk', title: 'Kort', fields: [{name: 'kort', title: 'Kortet', type: 'composite', fields: [{name: 'bilde', title: 'Kortbilde', type: 'image', options: {minWidth: 1200}}, {name: 'tekst', title: 'Tekst', type: 'string', validation: {required: true}}]}]},
      {name: 'image', title: 'Bilde i teksten', type: 'image', options: {minWidth: 1200}},
    ]}},
  ],
} as never
const doc = (fields: Record<string, unknown>) => ({_id: 's', _publishedId: 's', _type: 'side', _draft: true, _rev: 'r', _updatedAt: '', ...fields}) as never
const said = (fields: Record<string, unknown>, w: WidthOf | null = widthOf) => validate(doc(fields), schema, undefined, undefined, undefined, w ?? undefined).map((p) => `${p.level} ${p.path}: ${p.message}`)

test("an 800 px image under minWidth 1200 warns, in the field's words; 1200 gives none; an array member the same", () => {
  assert.deepEqual(said({hovedbilde: img('image-small')}), [`warning hovedbilde: ${HSO}`, 'error bilde: Legg inn et bilde'])
  assert.deepEqual(said({hovedbilde: img('image-wide'), bilde: img('image-wide')}), [])
  const items = [{_key: 'k1', ...img('image-wide')}, {_key: 'k2', ...img('image-small')}]
  assert.deepEqual(said({bilde: img('image-wide'), bilder: items}), [`warning bilder[_key=="k2"]: ${HSO}`])
  assert.deepEqual(said({bilde: img('image-wide'), blokk: {bilde: img('image-small')}}), [`warning blokk.bilde: ${HSO}`])
  // An image field inside an array's object item: the warning on that item's field.
  const cards = [{_key: 'k1', bilde: img('image-wide')}, {_key: 'k2', bilde: img('image-small')}]
  assert.deepEqual(said({bilde: img('image-wide'), kort: cards}), [`warning kort[_key=="k2"].bilde: ${HSO}`])
})

test('an image in a rich-text block warns the same, at the image, at any depth in the block; no other rule looks inside the text', () => {
  const quiet = {bilde: img('image-wide')}
  const text = {_type: 'block', _key: 't', children: [{_type: 'span', text: 'Hei'}]}
  const gallery = {_type: 'bildeblokk', _key: 'b', bilder: [{_key: 'k1', ...img('image-wide')}, {_key: 'k2', ...img('image-small')}], stort: img('image-small')}
  const found = validate(doc({...quiet, innhold: [text, gallery]}), schema, undefined, undefined, undefined, widthOf)
  assert.deepEqual(found.map((p) => [p.level, p.path, p.parents, p.title, p.message]), [
    ['warning', 'innhold[_key=="b"].bilder[_key=="k2"]', ['Innhold', 'Bilde'], 'Bilder', HSO],
    ['warning', 'innhold[_key=="b"].stort', ['Innhold', 'Bilde'], 'Stort bilde', 'The image is under 1200 pixels wide. It may look blurry.'],
  ])
  assert.deepEqual(errorsOf(found), [], 'never blocks Publish')
  assert.deepEqual(said({...quiet, innhold: [{...gallery, bilder: [], stort: img('image-wide')}]}), [])
  // A required field and a URL in a block are Barkpark's findings, not this check's: nothing new here.
  assert.deepEqual(said({...quiet, innhold: [{_type: 'faktaboks', _key: 'f', lenke: 'not a url'}]}), [])
  // Deeper: an object in a block (its required text stays unchecked here), and an image block.
  const deep = [{_type: 'kortblokk', _key: 'c', kort: {bilde: img('image-small'), tekst: ''}}, {_key: 'i', ...img('image-small')}]
  assert.deepEqual(said({...quiet, innhold: deep}), [
    'warning innhold[_key=="c"].kort.bilde: The image is under 1200 pixels wide. It may look blurry.',
    'warning innhold[_key=="i"]: The image is under 1200 pixels wide. It may look blurry.',
  ])
})

test('a warning, never an error: a required field with minWidth reports each with its own words, and Publish is not blocked by the width', () => {
  // The Studio's words where the field has none of its own.
  assert.deepEqual(said({bilde: img('image-small')}), ['warning bilde: The image is under 1200 pixels wide. It may look blurry.'])
  assert.deepEqual(errorsOf(validate(doc({bilde: img('image-small'), hovedbilde: img('image-small')}), schema, undefined, undefined, undefined, widthOf)), [])
  assert.deepEqual(said({}), ['error bilde: Legg inn et bilde'])
})

test('no width known gives nothing, never a guess; an SVG never warns; no minWidth, no rule', () => {
  const quiet = {bilde: img('image-wide')}
  assert.deepEqual(said({...quiet, hovedbilde: img('image-nowidth')}), [])
  assert.deepEqual(said({...quiet, hovedbilde: img('image-zero')}), [], 'a width of 0 is no width')
  assert.deepEqual(said({...quiet, hovedbilde: img('image-unread')}), [], 'not read yet (or the read failed)')
  assert.deepEqual(said({...quiet, hovedbilde: img('image-small')}, null), [], 'no width reader at all')
  assert.deepEqual(said({...quiet, hovedbilde: img('image-vector')}), [])
  assert.deepEqual(said({...quiet, hovedbilde: img(`image-${'b'.repeat(40)}-300x300-svg`)}), [])
  assert.deepEqual(said({...quiet, hovedbilde: img(`image-${'a'.repeat(40)}-640x480-jpg`)}), [`warning hovedbilde: ${HSO}`])
  assert.deepEqual(said({...quiet, fritt: img('image-small')}), [])
  assert.deepEqual(said({...quiet, fil: img('image-small')}), [], 'minWidth on a file is no rule')
})

test("one reader for the width: the pane asks the media-info read (a Sanity id's size, then the asset's metadata), no copy of its own", () => {
  const pane = readFileSync(new URL('../components/DocumentPane.tsx', import.meta.url), 'utf8').replace(/\s+/g, ' ')
  assert.ok(pane.includes('qcHere.getQueryData(fileInfoQuery(ref).queryKey)'), 'the width is the media-info read, from the cache')
  assert.ok(pane.includes('useQueries({queries: [...askedWidths].map(fileInfoQuery)})'), 'the refs the check asked for are read')
  const info = readFileSync(new URL('../routes/api/media/$id/info.ts', import.meta.url), 'utf8')
  assert.ok(info.includes('width: sanity.width') && info.includes('...imageMeta(result)'), 'a Sanity id first, then the metadata')
})
