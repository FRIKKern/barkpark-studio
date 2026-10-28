import {test} from 'node:test'
import assert from 'node:assert/strict'
import {declaredVocabulary, editorSchema, equal, inferFields, isPortableTextField, mergeValue, newKey, objectFields, observedVocabulary, offeredAnnotations, refTargets, storedShape, type PtBlock} from './pt-value.ts'

// Made-up content only (the repo is public).
const stored = (): PtBlock[] => [
  // No style and no markDefs: the editor fills both in when it reads the block.
  {_key: 'b1', _type: 'block', children: [{_key: 's1', _type: 'span', text: 'Tea is brewed with hot water.'}]},
  {
    _key: 'b2',
    _type: 'block',
    style: 'normal',
    extraFlag: true,
    markDefs: [{_key: 'm1', _type: 'internalLink', reference: {_ref: 'page-kettle', _type: 'reference'}}],
    children: [
      {_key: 's2', _type: 'span', marks: ['strong'], text: 'Steep it '},
      {_key: 's3', _type: 'span', marks: ['m1', 'glow'], text: 'three minutes'},
      {_key: 'i1', _type: 'teaChip', label: 'Green', tint: 4},
      {_key: 's4', _type: 'span', marks: [], text: ' at most.'},
    ],
  },
  {_key: 'c1', _type: 'kettleCallout', tone: 'warm', nested: {list: [1, 2, {deep: 'yes'}]}},
  {_key: 'b3', _type: 'block', style: 'h2', listItem: 'bullet', level: 1, markDefs: [], children: [{_key: 's5', _type: 'span', marks: [], text: 'Cups'}]},
]

/** What the editor makes of a stored value: its defaults filled in, its own key order. */
function editorReading(value: PtBlock[]): PtBlock[] {
  return value.map((b) =>
    b._type !== 'block'
      ? {_key: b._key, ...b}
      : ({
          _type: 'block',
          _key: b._key,
          style: b.style ?? 'normal',
          ...(b.listItem !== undefined && {listItem: b.listItem, level: b.level}),
          markDefs: b.markDefs ?? [],
          children: (b.children as Record<string, unknown>[]).map((c) => (c._type === 'span' ? {_type: 'span', _key: c._key, text: c.text, marks: c.marks ?? []} : {...c})),
        } as PtBlock),
  )
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

test('pt: opening and closing with no edit gives the stored value back, byte for byte', () => {
  const value = stored()
  const seen = editorReading(value)
  const merged = mergeValue(value, seen, clone(seen))
  assert.equal(JSON.stringify(merged), JSON.stringify(value))
  merged.forEach((b, i) => assert.equal(b, value[i]))
})

test('pt: one word edited changes that span only, and every _key stays', () => {
  const value = stored()
  const seen = editorReading(value)
  const next = clone(seen)
  ;(next[0].children as {text: string}[])[0].text = 'Tea is brewed with warm water.'
  const merged = mergeValue(value, seen, next)
  const expected = clone(value)
  ;(expected[0].children as {text: string}[])[0].text = 'Tea is brewed with warm water.'
  // The edited block keeps its stored shape: no style or markDefs added, the span no marks.
  assert.deepEqual(merged, expected)
  assert.deepEqual(merged.map((b) => b._key), ['b1', 'b2', 'c1', 'b3'])
  for (const i of [1, 2, 3]) assert.equal(merged[i], value[i])
})

test('pt: custom blocks, inline objects, unknown marks and markDefs survive an edit elsewhere in their block', () => {
  const value = stored()
  const seen = editorReading(value)
  const next = clone(seen)
  ;(next[1].children as {text: string}[])[3].text = ' at the very most.'
  // An editor that also lost a custom block's field and an inline object's field still saves them as stored.
  delete (next[2] as Record<string, unknown>).nested
  delete (next[1].children as Record<string, unknown>[])[2].tint
  const merged = mergeValue(value, seen, next)
  assert.equal(JSON.stringify(merged[2]), JSON.stringify(value[2]))
  const b2 = merged[1] as unknown as {markDefs: unknown[]; children: unknown[]; extraFlag: boolean}
  const was = value[1] as unknown as typeof b2
  assert.equal(b2.markDefs, was.markDefs)
  assert.equal(b2.extraFlag, true)
  for (const i of [0, 1, 2]) assert.equal(b2.children[i], was.children[i])
  assert.deepEqual(b2.children[3], {_key: 's4', _type: 'span', marks: [], text: ' at the very most.'})
})

test('pt: style and list changes land; a deleted block is gone; a new block is the editor\'s', () => {
  const value = stored()
  const seen = editorReading(value)
  const next = clone(seen)
  next[0].style = 'h3'
  delete next[3].listItem
  delete next[3].level
  next.splice(2, 1)
  next.push({_type: 'block', _key: 'new1', style: 'normal', markDefs: [], children: [{_type: 'span', _key: 'n1', text: 'Milk?', marks: []}]})
  const merged = mergeValue(value, seen, next)
  assert.deepEqual(merged.map((b) => b._key), ['b1', 'b2', 'b3', 'new1'])
  assert.equal(merged[0].style, 'h3')
  assert.equal(merged[2].listItem, undefined)
  assert.equal(merged[2].level, undefined)
  assert.equal(merged[1], value[1])
})

test('pt: a stored block the editor never loaded is put back where it was', () => {
  const value = stored()
  const seen = editorReading(value).filter((b) => b._key !== 'c1')
  const next = clone(seen)
  ;(next[2].children as {text: string}[])[0].text = 'Mugs'
  const merged = mergeValue(value, seen, next)
  assert.deepEqual(merged.map((b) => b._key), ['b1', 'b2', 'c1', 'b3'])
  assert.equal(merged[2], value[2])
})

test('pt: the editor schema is the declared vocabulary plus every name the value uses', () => {
  const field = {blocks: {styles: ['normal', {title: 'Heading', value: 'h2'}], lists: ['bullet'], marks: ['strong', 'strikethrough'], annotations: [{name: 'link', fields: []}], of: [{name: 'kettleCallout', title: 'Kettle callout'}]}}
  const declared = declaredVocabulary(field)
  assert.deepEqual(declared.styles, [{name: 'normal'}, {name: 'h2', title: 'Heading'}])
  assert.deepEqual(declared.decorators, [{name: 'strong'}, {name: 'strike-through'}])
  assert.deepEqual(observedVocabulary(stored()).decorators, [{name: 'strong'}, {name: 'glow'}])
  const schema = editorSchema(field, stored())
  assert.deepEqual(schema.styles.map((s) => s.name), ['normal', 'h2'])
  assert.deepEqual(schema.lists.map((s) => s.name), ['bullet'])
  assert.deepEqual(schema.decorators.map((s) => s.name), ['strong', 'strike-through', 'glow'])
  assert.deepEqual(schema.annotations.map((s) => s.name), ['link', 'internalLink'])
  assert.deepEqual(schema.blockObjects, [{name: 'kettleCallout', title: 'Kettle callout'}])
  assert.deepEqual(schema.inlineObjects.map((s) => s.name), ['teaChip'])
  // No declaration: Sanity's defaults.
  assert.deepEqual(declaredVocabulary({}).decorators.map((d) => d.name), ['strong', 'em', 'code', 'underline', 'strike-through'])
  assert.deepEqual(editorSchema({blocks: {styles: ['h2']}}, []).styles.map((s) => s.name), ['normal', 'h2'])
})

test('pt: which rich text fields are Portable Text', () => {
  assert.equal(isPortableTextField({type: 'richText'}, stored()), true)
  assert.equal(isPortableTextField({type: 'richText'}, [{_type: 'kettleCallout'}]), false)
  assert.equal(isPortableTextField({type: 'richText'}, {blocks: []}), false)
  assert.equal(isPortableTextField({type: 'richText'}, undefined), false)
  assert.equal(isPortableTextField({type: 'richText', format: 'portableText'}, undefined), true)
  assert.equal(isPortableTextField({type: 'arrayOf'}, stored()), false)
  assert.equal(equal({a: 1, b: [1, {c: 2}]}, {b: [1, {c: 2}], a: 1}), true)
  assert.equal(equal({a: 1}, {a: 1, b: 2}), false)
})

// S4b: annotations.
const schemas = [
  {name: 'recipe', fields: [{name: 'title', type: 'string'}]},
  {name: 'pantry', fields: [{name: 'title', type: 'string'}]},
  {name: 'linkBox', kind: 'object', fields: [{name: 'target', type: 'reference', to: [{type: 'recipe'}]}]},
]

test('pt: the toolbar offers declared annotations; none declared, those the value uses; none used, link', () => {
  assert.deepEqual(offeredAnnotations({blocks: {annotations: [{name: 'note', title: 'Note'}]}}, stored()), [{name: 'note', title: 'Note'}])
  assert.deepEqual(offeredAnnotations({}, stored()), [{name: 'internalLink'}])
  assert.deepEqual(offeredAnnotations({blocks: {}}, []), [{name: 'link'}])
})

test('pt: an annotation dialog takes declared fields, else fields read off stored markDefs, else link\'s href', () => {
  const declared = [{name: 'target', type: 'reference', to: [{type: 'pantry'}]}]
  assert.deepEqual(objectFields({blocks: {annotations: [{name: 'internalLink', fields: declared}]}}, 'annotation', 'internalLink', stored(), schemas), declared)
  // Read off the value: the reference targets every document type (no field of that name declares any).
  assert.deepEqual(objectFields({}, 'annotation', 'internalLink', stored(), schemas), [{name: 'reference', title: 'Reference', type: 'reference', to: [{type: 'recipe'}, {type: 'pantry'}]}])
  assert.deepEqual(objectFields({}, 'annotation', 'link', [], schemas), [{name: 'href', title: 'URL', type: 'url'}])
  // linkType is a plain field, never required; a reference takes a same-named declared field's targets.
  const fields = inferFields([{_key: 'k', _type: 'linkNote', linkType: 'internal', target: {_ref: 'r1', _type: 'reference'}, openInNewTab: true, url: 'https://example.com', email: 'tea@example.com', extra: {deep: 1}}], schemas)
  assert.deepEqual(fields.map((f) => [f.name, f.type]), [['linkType', 'string'], ['target', 'reference'], ['openInNewTab', 'boolean'], ['url', 'url'], ['email', 'email']])
  assert.equal(fields.some((f) => f.validation), false)
  assert.deepEqual(fields[1].to, [{type: 'recipe'}])
  assert.deepEqual(refTargets('missing', schemas), [{type: 'recipe'}, {type: 'pantry'}])
})

test('pt: the editor schema names every field an annotation holds, so the editor keeps them', () => {
  const schema = editorSchema({}, stored(), schemas)
  assert.deepEqual(schema.annotations.find((a) => a.name === 'internalLink')?.fields, [{name: 'reference', type: 'object'}])
  assert.deepEqual(schema.annotations.find((a) => a.name === 'link')?.fields, [{name: 'href', type: 'string'}])
})

test('pt: a dialog value is stored Sanity-shaped; an unchanged reference keeps its stored object', () => {
  const fields = [{name: 'target', type: 'reference'}, {name: 'label', type: 'string'}]
  const was = {_key: 'm9', _type: 'linkNote', target: {_ref: 'r1', _type: 'internalLink'}, label: 'Old'}
  assert.deepEqual(storedShape(fields, {...was, target: 'r2'}, was), {_key: 'm9', _type: 'linkNote', target: {_ref: 'r2', _type: 'internalLink'}, label: 'Old'})
  assert.equal(storedShape(fields, {...was, target: 'r1'}, was).target, was.target)
  assert.deepEqual(storedShape(fields, {_type: 'linkNote', target: 'r3'}), {_type: 'linkNote', target: {_type: 'reference', _ref: 'r3'}})
  assert.deepEqual(storedShape(fields, {...was, label: undefined}, was), {_key: 'm9', _type: 'linkNote', target: was.target})
  assert.match(newKey(), /^[0-9a-f]{12}$/)
})

test('pt: an edited markDef changes only what was edited; the others in its block go back as stored', () => {
  const value = stored()
  ;(value[1].markDefs as unknown[]).push({_key: 'm2', _type: 'internalLink', reference: {_ref: 'page-cups', _type: 'reference'}, keep: {a: [1]}})
  const seen = editorReading(value)
  const next = clone(seen)
  const defs = next[1].markDefs as Record<string, unknown>[]
  defs[1] = {...defs[1], reference: {_ref: 'page-pots', _type: 'reference'}}
  // A new link on the first block, its span marked.
  next[0].markDefs = [{_key: 'aaaaaaaaaaaa', _type: 'link', href: 'https://example.com'}]
  ;(next[0].children as {marks: string[]}[])[0].marks = ['aaaaaaaaaaaa']
  const merged = mergeValue(value, seen, next)
  const was = value[1].markDefs as unknown[]
  const now = merged[1].markDefs as Record<string, unknown>[]
  assert.equal(now[0], was[0])
  assert.deepEqual(now[1], {_key: 'm2', _type: 'internalLink', reference: {_ref: 'page-pots', _type: 'reference'}, keep: {a: [1]}})
  assert.deepEqual(merged[0].markDefs, [{_key: 'aaaaaaaaaaaa', _type: 'link', href: 'https://example.com'}])
  for (const i of [2, 3]) assert.equal(merged[i], value[i])
  // A field the dialog emptied goes from that markDef only.
  const next2 = clone(seen)
  delete (next2[1].markDefs as Record<string, unknown>[])[1].keep
  assert.deepEqual((mergeValue(value, seen, next2)[1].markDefs as unknown[])[1], {_key: 'm2', _type: 'internalLink', reference: {_ref: 'page-cups', _type: 'reference'}})
})
