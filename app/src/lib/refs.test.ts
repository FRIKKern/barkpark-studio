import {test} from 'node:test'
import assert from 'node:assert/strict'
import {convertedRef, pastedRef, pickedRef, readDocOf, refOpenType, refTarget, strengthenUnsets, strengthMismatch, waitingRefs} from './refs.ts'
import {validate} from './validation.ts'
import type {Doc as StudioDoc, Schema} from './data.ts'

// A made-up dataset: a reference field to author or guest, and an id only guest holds.
type Doc = {_id: string; _type: string; name: string}
const docs: Doc[] = [
  {_id: 'g1', _type: 'guest', name: 'Ada Example'},
  {_id: 'a1', _type: 'author', name: 'Bo Sample'},
]
function store() {
  const reads: string[] = []
  return {
    reads,
    io: {
      typeOf: async (id: string) => (reads.push(`typeOf ${id}`), docs.find((d) => d._id === id)?._type),
      read: async (type: string, id: string) => (reads.push(`${type} ${id}`), docs.find((d) => d._id === id && d._type === type) ?? null),
    },
  }
}

test('a reference preview loads its doc when the first to type does not hold it', async () => {
  const {reads, io} = store()
  const doc = await readDocOf(['author', 'guest'], 'g1', io)
  assert.equal(doc?.name, 'Ada Example')
  // One read names the type, one reads the doc as it: never as the first type.
  assert.deepEqual(reads, ['typeOf g1', 'guest g1'])
  // The row opens the doc as its own type.
  assert.equal(refOpenType(['author', 'guest'], doc), 'guest')
  // Read as the first type alone, the row has nothing to show: what kept it at "…".
  assert.equal(await readDocOf(['author'], 'g1', store().io), null)
})

test('a reference preview of the first to type, of one type, and of a type not listed', async () => {
  assert.equal((await readDocOf(['author', 'guest'], 'a1', store().io))?.name, 'Bo Sample')
  const one = store()
  assert.equal((await readDocOf(['author'], 'a1', one.io))?.name, 'Bo Sample')
  assert.deepEqual(one.reads, ['author a1'])
  // Held by a type the field does not list, or by none: no doc.
  assert.equal(await readDocOf(['author', 'post'], 'g1', store().io), null)
  assert.equal(await readDocOf(['author', 'guest'], 'missing', store().io), null)
  assert.equal(await readDocOf([], 'a1', store().io), null)
  // Before the doc loads, and for a doc of a type not listed, the row opens as the first type.
  assert.equal(refOpenType(['author', 'guest'], undefined), 'author')
  assert.equal(refOpenType(['author', 'guest'], {_type: 'post'}), 'author')
})

test('a reference row to an id no document holds shows the unavailable mark, not … forever', async () => {
  // The read has not answered: the row shows "…".
  assert.equal(refTarget(undefined), 'loading')
  // Read as any of its types, an id no document holds answers null: Sanity's unavailable mark.
  const gone = await readDocOf(['author', 'guest'], 'nobody-holds-this', store().io)
  assert.equal(gone, null)
  assert.equal(refTarget(gone), 'missing')
  // Held by a type the reference does not list: missing too, as Sanity marks it.
  assert.equal(refTarget(await readDocOf(['author', 'post'], 'g1', store().io)), 'missing')
  // Found, the row shows the document.
  assert.equal(refTarget(await readDocOf(['author', 'guest'], 'g1', store().io)), 'found')
})

// Weak references, Sanity's ReferenceInput (task-288f7978607cdc89). Barkpark refuses to delete a
// document a bare id or an object without `_weak: true` points at.
test('weak references: a pick stores Sanity\'s weak object, and replacing a stored one keeps its shape', () => {
  const published = {published: true, type: 'author'}
  // A weak field: picking a1 stores the object (main stored the bare id 'a1', which Barkpark counts as strong).
  assert.deepEqual(pickedRef(undefined, 'a1', {...published, weak: true}), {_type: 'reference', _ref: 'a1', _weak: true})
  // Replacing an imported weak reference keeps the object and its strength (main: the bare id).
  assert.deepEqual(pickedRef({_type: 'reference', _ref: 'a0', _weak: true}, 'a1', {...published, weak: true}), {_type: 'reference', _ref: 'a1', _weak: true})
  // A strong field over a stored object: the object without `_weak`, a named type and an array key kept.
  assert.deepEqual(pickedRef({_key: 'k1', _type: 'internalLink', _ref: 'a0', _weak: true, _strengthenOnPublish: {type: 'author'}}, 'a1', published), {_key: 'k1', _type: 'internalLink', _ref: 'a1'})
  // A strong field over nothing or a bare id: the bare id, Barkpark's shape; nothing stored is rewritten before a pick.
  assert.equal(pickedRef(undefined, 'a1', published), 'a1')
  assert.equal(pickedRef('a0', 'a1', published), 'a1')
  // A target with no published version: weak until publish, as Sanity writes it (the type for its preview).
  assert.deepEqual(pickedRef('a0', 'd1', {published: false, type: 'author'}), {_type: 'reference', _ref: 'd1', _weak: true, _strengthenOnPublish: {type: 'author'}})
  assert.deepEqual(pickedRef({_key: 'k1', _type: 'reference'}, 'd1', {published: false, type: 'author', weak: true, template: 'author-guest'}), {_key: 'k1', _type: 'reference', _ref: 'd1', _weak: true, _strengthenOnPublish: {type: 'author', weak: true, template: 'author-guest'}})
})

test('weak references: a strength the schema disagrees with shows the strip, and Convert writes the schema\'s', () => {
  assert.equal(strengthMismatch('a1', true), 'strong') // a bare id in a weak field
  assert.equal(strengthMismatch({_type: 'reference', _ref: 'a1', _weak: true}, false), 'weak')
  assert.equal(strengthMismatch({_type: 'reference', _ref: 'a1', _weak: true}, true), null)
  assert.equal(strengthMismatch('a1', false), null)
  assert.equal(strengthMismatch(undefined, true), null)
  // Waiting for a publish is weak on purpose: no strip.
  assert.equal(strengthMismatch({_type: 'reference', _ref: 'd1', _weak: true, _strengthenOnPublish: {type: 'author'}}, false), null)
  assert.deepEqual(convertedRef('a1', true), {_type: 'reference', _ref: 'a1', _weak: true})
  assert.deepEqual(convertedRef({_key: 'k', _type: 'reference', _ref: 'a1', _weak: true}, false), {_key: 'k', _type: 'reference', _ref: 'a1'})
  // A paste takes the target field's strength; one waiting for a publish stays waiting.
  assert.deepEqual(pastedRef('a1', true), {_type: 'reference', _ref: 'a1', _weak: true})
  assert.equal(pastedRef('a1', false), 'a1')
  assert.deepEqual(pastedRef({_type: 'reference', _ref: 'a1', _weak: true}, false), {_type: 'reference', _ref: 'a1'})
  assert.deepEqual(pastedRef({_type: 'reference', _ref: 'd1', _strengthenOnPublish: {type: 'author'}}, false), {_type: 'reference', _ref: 'd1', _strengthenOnPublish: {type: 'author'}, _weak: true})
})

test('weak references: publish strengthens the waiting ones whose target is published, by path', () => {
  const waiting = (id: string, weak?: boolean) => ({_ref: id, _weak: true, _strengthenOnPublish: {type: 'author', ...(weak ? {weak} : {})}})
  const doc = {
    _id: 'drafts.p1', _type: 'post', _strengthenOnPublish: 'not walked',
    author: {_type: 'reference', ...waiting('a1')},
    seo: {by: waiting('d1')},
    tags: [{_key: 't1', ...waiting('a1')}, waiting('a2'), 'a3'],
    weakRef: waiting('d1', true),
    body: [{_type: 'block', _key: 'b1', markDefs: [{_key: 'm1', _type: 'link', ...waiting('a2')}], children: []}],
    plain: {_type: 'reference', _ref: 'a1', _weak: true},
  }
  assert.deepEqual(waitingRefs(doc).map((r) => r.path), ['author', 'seo.by', 'tags[_key=="t1"]', 'tags[1]', 'weakRef', 'body[_key=="b1"].markDefs[_key=="m1"]'])
  // a1 and a2 are published, d1 is not: a strong field's reference to d1 stays weak and waiting;
  // a weak field's drops only the marker, whatever its target.
  assert.deepEqual(strengthenUnsets(doc, new Set(['a1', 'a2'])), [
    'author._strengthenOnPublish', 'author._weak',
    'tags[_key=="t1"]._strengthenOnPublish', 'tags[_key=="t1"]._weak',
    'tags[1]._strengthenOnPublish', 'tags[1]._weak',
    'weakRef._strengthenOnPublish',
    'body[_key=="b1"].markDefs[_key=="m1"]._strengthenOnPublish', 'body[_key=="b1"].markDefs[_key=="m1"]._weak',
  ])
  assert.deepEqual(strengthenUnsets({_id: 'p2', title: 'none'}, new Set()), [])
})

test('weak references: "must be published" for a strong reference in either shape, never for a weak field', () => {
  const schema: Schema = {name: 'post', title: 'Post', fields: [{name: 'author', type: 'reference', refType: 'author'}, {name: 'weakRef', type: 'reference', refType: 'post', weak: true}]}
  const doc = (fields: Record<string, unknown>) => ({_id: 'p', _publishedId: 'p', _type: 'post', _draft: true, _rev: 'r', _updatedAt: '', ...fields}) as StudioDoc
  const draftOnly = {...doc({}), _hasPublished: false}
  const messages = (d: StudioDoc) => validate(d, schema, () => draftOnly).map((p) => `${p.path}: ${p.message}`)
  assert.deepEqual(messages(doc({author: 'd1'})), ['author: Referenced document must be published'])
  // Sanity's object (an import, a pick waiting for publish) is checked too; main read only bare ids.
  assert.deepEqual(messages(doc({author: {_type: 'reference', _ref: 'd1', _weak: true, _strengthenOnPublish: {type: 'author'}}})), ['author: Referenced document must be published'])
  assert.deepEqual(messages(doc({weakRef: {_type: 'reference', _ref: 'd1', _weak: true}})), [])
})
