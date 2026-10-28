import {test} from 'node:test'
import assert from 'node:assert/strict'
import {changedBlocks, declaredVocabulary, editorSchema, equal, inferFields, insertable, isOutsideValue, isPortableTextField, markdownNames, mergeValue, newKey, objectChanges, objectFields, objectTitle, observedVocabulary, offeredAnnotations, pastesLinks, refTargets, storedShape, type PtBlock} from './pt-value.ts'

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
  assert.deepEqual(schema.blockObjects, [{name: 'kettleCallout', title: 'Kettle callout', fields: [{name: 'tone', type: 'string'}, {name: 'nested', type: 'object'}]}])
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

// S4c: custom blocks and inline objects.
test('pt: a custom block or inline object dialog takes declared fields, else the named object type, else stored keys', () => {
  const cupFields = [{name: 'size', type: 'number'}]
  const all = [...schemas, {name: 'teapot', title: 'Teapot', kind: 'object', fields: [{name: 'volume', type: 'number'}]}]
  const field = {blocks: {of: ['image', {name: 'teapot'}, {name: 'cup', title: 'Cup', fields: cupFields}], inline: [{name: 'teaChip', title: 'Tea chip'}]}}
  assert.deepEqual(objectFields(field, 'block', 'cup', stored(), all), cupFields)
  assert.deepEqual(objectFields(field, 'block', 'teapot', stored(), all), [{name: 'volume', type: 'number'}])
  assert.deepEqual(objectFields(field, 'inline', 'teaChip', stored(), all).map((f) => [f.name, f.type]), [['label', 'string'], ['tint', 'number']])
  assert.deepEqual(objectFields(field, 'block', 'kettleCallout', stored(), all).map((f) => f.name), ['tone'])
  assert.equal(objectTitle(field, 'block', 'teapot', all), 'Teapot')
  assert.equal(objectTitle(field, 'block', 'cup', all), 'Cup')
  // Insert offers the declared types; an image block needs its own input.
  assert.deepEqual(insertable(field), {blocks: [{name: 'image'}, {name: 'teapot'}, {name: 'cup', title: 'Cup'}], inline: [{name: 'teaChip', title: 'Tea chip'}]})
  // The editor is told every field, so block.set keeps them.
  assert.deepEqual(editorSchema(field, stored(), all).blockObjects.find((b) => b.name === 'cup')?.fields, [{name: 'size', type: 'number'}])
})

test('pt: a dialog changes only what it changed; an untouched empty string stays', () => {
  const node = {_key: 'c1', _type: 'kettleCallout', tone: 'warm', note: '', nested: {list: [1]}}
  const fields = [{name: 'tone', type: 'string'}, {name: 'note', type: 'string'}]
  assert.deepEqual(objectChanges(node, storedShape(fields, {...node}, node)), {set: {}, unset: []})
  assert.deepEqual(objectChanges(node, storedShape(fields, {...node, tone: 'cold'}, node)), {set: {tone: 'cold'}, unset: []})
  assert.deepEqual(objectChanges(node, storedShape(fields, {...node, tone: undefined}, node)), {set: {}, unset: ['tone']})
})

test('pt: an edited custom block or inline object changes only the keys edited, the rest as stored', () => {
  const value = stored()
  const seen = editorReading(value)
  const next = clone(seen)
  ;(next[2] as Record<string, unknown>).tone = 'cold'
  ;(next[1].children as Record<string, unknown>[])[2].label = 'Black'
  // A new custom block and a new inline object: as the editor has them.
  next.push({_type: 'kettleCallout', _key: '0123456789ab'})
  ;(next[3].children as unknown[]).push({_type: 'teaChip', _key: 'ba9876543210'})
  const merged = mergeValue(value, seen, next)
  assert.deepEqual(merged[2], {_key: 'c1', _type: 'kettleCallout', tone: 'cold', nested: {list: [1, 2, {deep: 'yes'}]}})
  assert.equal(merged[2].nested, value[2].nested)
  assert.deepEqual((merged[1].children as unknown[])[2], {_key: 'i1', _type: 'teaChip', label: 'Black', tint: 4})
  assert.equal(merged[0], value[0])
  assert.deepEqual(merged[4], {_type: 'kettleCallout', _key: '0123456789ab'})
  assert.deepEqual((merged[3].children as unknown[]).at(-1), {_type: 'teaChip', _key: 'ba9876543210'})
})

test('pt: Markdown shortcuts use only what the field declares; a URL pasted over text links it where link is offered', () => {
  // None declared: Sanity's defaults, so every shortcut works.
  const all = markdownNames({})
  assert.deepEqual([all.boldDecorator, all.italicDecorator, all.codeDecorator, all.strikeThroughDecorator], ['strong', 'em', 'code', 'strike-through'])
  assert.deepEqual([all.defaultStyle, all.blockquoteStyle, all.headingStyle(1), all.headingStyle(6), all.unorderedList, all.orderedList], ['normal', 'blockquote', 'h1', 'h6', 'bullet', 'number'])
  // A narrow field: `## ` stays text where h2 isn't declared, `~~` where strike isn't.
  const narrow = markdownNames({blocks: {styles: ['normal', 'h1'], lists: ['bullet'], marks: ['strong']}})
  assert.deepEqual([narrow.headingStyle(1), narrow.headingStyle(2), narrow.blockquoteStyle, narrow.orderedList, narrow.italicDecorator, narrow.strikeThroughDecorator], ['h1', undefined, undefined, undefined, undefined, undefined])
  // Barkpark's `strikethrough` is Portable Text's `strike-through`.
  assert.equal(markdownNames({blocks: {marks: ['strikethrough']}}).strikeThroughDecorator, 'strike-through')
  assert.equal(pastesLinks({}, []), true)
  assert.equal(pastesLinks({blocks: {annotations: [{name: 'wikilink'}]}}, []), false)
  assert.equal(pastesLinks({blocks: {annotations: [{name: 'link'}, {name: 'wikilink'}]}}, []), true)
})

test('pt: a value going back to the one the editor opened with shows after edits (Discard changes); its own saves coming back do not remount', () => {
  const opened = stored()
  const typed = JSON.parse(JSON.stringify(opened)) as PtBlock[]
  ;(typed[0].children as {text: string}[])[0].text = 'Tea is brewed with warm water.'
  const more = JSON.parse(JSON.stringify(typed)) as PtBlock[]
  ;(more[0].children as {text: string}[])[0].text = 'Tea is brewed with warm, soft water.'
  // Nothing typed: the value it opened with is what it shows.
  assert.equal(isOutsideValue(stored(), opened, []), false)
  // Typed twice: each save coming back, the latest or an older one, is its own.
  assert.equal(isOutsideValue(more, more, [typed, more]), false)
  assert.equal(isOutsideValue(typed, more, [typed, more]), false)
  // The draft discarded: back to the value it opened with, which it no longer shows.
  assert.equal(isOutsideValue(stored(), more, [typed, more]), true)
  // Another editor's change.
  assert.equal(isOutsideValue([...more, {_key: 'b9', _type: 'block', children: []}], more, [typed, more]), true)
})

test('pt: an image block is insertable (a file block is not) and the editor keeps its asset, hotspot and crop', () => {
  const field = {blocks: {of: ['image', 'file', {name: 'callout'}]}}
  assert.deepEqual(insertable(field).blocks.map((b) => b.name), ['image', 'callout'])
  const image = editorSchema(field, []).blockObjects.find((b) => b.name === 'image')!
  assert.deepEqual(image.fields?.map((f) => [f.name, f.type]), [['asset', 'object'], ['hotspot', 'object'], ['crop', 'object']])
})

test('pt: an edit inside blocks sends those blocks by key; a block that came, went or moved sends the field', () => {
  const before = stored()
  const typed = JSON.parse(JSON.stringify(before)) as PtBlock[]
  ;(typed[0].children as {text: string}[])[0].text = 'Tea is brewed with warm water.'
  assert.deepEqual(changedBlocks(before, typed), [{key: 'b1', block: typed[0]}])
  assert.deepEqual(changedBlocks(before, stored()), [])
  // Added, removed, moved, or a key that is not a plain one: the whole field.
  assert.equal(changedBlocks(before, [...before, {_key: 'b9', _type: 'block', children: []}]), null)
  assert.equal(changedBlocks(before, before.slice(1)), null)
  assert.equal(changedBlocks(before, [before[1], before[0], ...before.slice(2)]), null)
  assert.equal(changedBlocks([{_key: 'a"b', _type: 'block'}], [{_key: 'a"b', _type: 'block', x: 1}]), null)
  assert.equal(changedBlocks(undefined, typed), null)
})
