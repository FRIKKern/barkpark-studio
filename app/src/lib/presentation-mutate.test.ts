import {test} from 'node:test'
import assert from 'node:assert/strict'
import type {Field, Schema} from './data.ts'
import {applyArrayOp, arrayField, holds, MUTATE_MAX, pageEdit, type ArrayOp} from './presentation-mutate.ts'
import {framePath, ownPath} from './presentation-comlink.ts'

// What @sanity/visual-editing 3.2.4 posts (read off the wire in our Presentation): its own
// copy of the document first, then one patch per step.
const copy = {_id: 'drafts.post-09', _type: 'post', title: 'Fixture post 09', links: [{_key: 'l1', title: 'Sanity docs'}, {_key: 'l2', title: 'Related post'}, {_key: 'l3', title: 'Third'}]}
const patch = (more: Record<string, unknown>) => ({patch: {id: 'drafts.post-09', ...more}})
const tx = (...patches: unknown[]) => ({mutations: [{createIfNotExists: copy}, ...patches]})
const l2 = copy.links[1]

test('pageEdit: the overlay\'s own transactions read as one array change, by key', () => {
  // Move → Up, on the second item: counted by index, read against the page's copy.
  assert.deepEqual(pageEdit(tx(patch({unset: ['links[1:2]']}), patch({insert: {before: 'links[0]', items: [l2]}}))), {id: 'post-09', path: 'links', op: {kind: 'move', key: 'l2', position: 'before', ref: 'l1'}})
  // Move → Down and To bottom: the index is the array's after the item left it.
  assert.deepEqual(pageEdit(tx(patch({unset: ['links[1:2]']}), patch({insert: {after: 'links[1]', items: [l2]}}))), {id: 'post-09', path: 'links', op: {kind: 'move', key: 'l2', position: 'after', ref: 'l3'}})
  assert.deepEqual(pageEdit(tx(patch({unset: ['links[0:1]']}), patch({insert: {after: 'links[-1]', items: [copy.links[0]]}}))), {id: 'post-09', path: 'links', op: {kind: 'move', key: 'l1', position: 'after', ref: 'l3'}})
  // A drag: by key on both sides.
  assert.deepEqual(pageEdit(tx(patch({unset: ['links[_key=="l3"]']}), patch({insert: {after: 'links[_key=="l1"]', items: [copy.links[2]]}}))), {id: 'post-09', path: 'links', op: {kind: 'move', key: 'l3', position: 'after', ref: 'l1'}})
  // Remove, Duplicate, Insert before.
  assert.deepEqual(pageEdit(tx(patch({unset: ['links[2:3]']}))), {id: 'post-09', path: 'links', op: {kind: 'remove', key: 'l3'}})
  assert.deepEqual(pageEdit(tx(patch({insert: {after: 'links[_key=="l2"]', items: [{...l2, _key: 'a1b2c3d4e5f6'}]}}))), {id: 'post-09', path: 'links', op: {kind: 'duplicate', key: 'l2', newKey: 'a1b2c3d4e5f6', position: 'after'}})
  assert.deepEqual(pageEdit(tx(patch({insert: {before: 'links[_key=="l1"]', items: [{_type: 'composite', _key: 'a1b2c3d4e5f6'}]}}))), {id: 'post-09', path: 'links', op: {kind: 'insert', member: 'composite', newKey: 'a1b2c3d4e5f6', position: 'before', ref: 'l1'}})
  // An array inside an array item.
  assert.deepEqual(pageEdit({mutations: [patch({unset: ['sections[_key=="s1"].tiles[_key=="t2"]']})]}), {id: 'post-09', path: 'sections[_key=="s1"].tiles', op: {kind: 'remove', key: 't2'}})
})

test('pageEdit: everything else a page can send is refused whole', () => {
  const refused = (data: unknown, why?: RegExp) => {
    const out = pageEdit(data)
    assert.ok('refused' in out, JSON.stringify(out))
    if (why) assert.match(out.refused, why)
  }
  const move = [patch({unset: ['links[1:2]']}), patch({insert: {before: 'links[0]', items: [l2]}})]
  // A set, an inc, a text patch: no value of the page's is ever written.
  refused(tx(patch({set: {title: 'Owned'}})))
  refused(tx(patch({unset: ['links[1:2]'], set: {title: 'Owned'}})))
  refused(tx(patch({unset: ['links[1:2]']}), patch({set: {title: 'Owned'}})), /not an array move/)
  refused(tx(patch({diffMatchPatch: {title: '@@ -1 +1 @@'}})))
  refused(tx(patch({unset: ['title']})))
  refused(tx(patch({unset: ['links']})))
  refused(tx(patch({unset: ['links[0:5]']})))
  refused(tx(patch({unset: ['links[_key=="l1"]', 'links[_key=="l2"]']})))
  refused(tx(patch({ifRevisionID: 'x', unset: ['links[1:2]']})))
  // Whole-document mutations.
  refused({mutations: [{createOrReplace: copy}]})
  refused({mutations: [{delete: {id: 'drafts.post-09'}}]})
  refused({mutations: [{create: copy}, ...move]})
  refused({mutations: [...move, {createIfNotExists: copy}]})
  refused({mutations: [{createIfNotExists: copy, delete: {id: 'post-09'}}, ...move]})
  // Another document, the published one, a release's version, a nested prefix.
  refused(tx(patch({unset: ['links[1:2]']}), {patch: {id: 'drafts.post-10', insert: {before: 'links[0]', items: [l2]}}}), /more than one document/)
  refused({mutations: [{createIfNotExists: {...copy, _id: 'drafts.post-10'}}, ...move]}, /more than one document/)
  refused({mutations: [{patch: {id: 'post-09', unset: ['links[_key=="l1"]']}}]}, /only a draft/)
  refused({mutations: [{patch: {id: 'versions.r1.post-09', unset: ['links[_key=="l1"]']}}]}, /only a draft/)
  refused({mutations: [{patch: {id: 'drafts.drafts.post-09', unset: ['links[_key=="l1"]']}}]}, /not a document id/)
  refused({mutations: [{patch: {id: 'drafts.versions.r1.post-09', unset: ['links[_key=="l1"]']}}]}, /not a document id/)
  refused({mutations: [{patch: {id: 'drafts.../x', unset: ['links[_key=="l1"]']}}]})
  refused({mutations: [{patch: {id: ['drafts.post-09'], unset: ['links[_key=="l1"]']}}]})
  // Paths with a prototype's names, an index into the path, a path that is not one.
  refused({mutations: [patch({unset: ['__proto__[_key=="l1"]']})]})
  refused({mutations: [patch({unset: ['a.constructor.prototype[_key=="l1"]']})]})
  refused({mutations: [patch({unset: ['sections[0].tiles[_key=="t2"]']})]})
  refused({mutations: [patch({unset: ['links[_key=="l1"] || true']})]})
  refused({mutations: [patch({unset: ['links[_key=="a\\"]x[_key==\\"b"]']})]})
  // A move that is not one: another item comes back, to another array, or beside itself.
  refused(tx(patch({unset: ['links[1:2]']}), patch({insert: {before: 'links[0]', items: [{...l2, _key: 'l3'}]}})), /not an array move/)
  refused(tx(patch({unset: ['links[1:2]']}), patch({insert: {before: 'tags[0]', items: [l2]}})), /not an array move/)
  refused(tx(patch({unset: ['links[_key=="l2"]']}), patch({insert: {before: 'links[_key=="l2"]', items: [l2]}})), /not an array move/)
  refused(tx(patch({unset: ['links[1:2]']}), patch({insert: {before: 'links[0]', items: [l2, l2]}})))
  refused(tx(patch({unset: ['links[1:2]']}), patch({insert: {before: 'links[0]', replace: 'links[1]', items: [l2]}})))
  // An index with no copy of the page's to read it against, or past its end.
  refused({mutations: move})
  refused({mutations: [patch({unset: ['links[1:2]']})]})
  refused(tx(patch({unset: ['links[7:8]']})))
  // An item of the page's own making: a "duplicate" that is not the item, an insert with fields, a key in use, a wild key.
  refused(tx(patch({insert: {after: 'links[_key=="l2"]', items: [{_key: 'n1', title: 'Injected', url: 'javascript:alert(1)'}]}})), /own making/)
  refused(tx(patch({insert: {after: 'links[_key=="l2"]', items: [{...l2, _key: 'n1', extra: 1}]}})), /own making/)
  refused(tx(patch({insert: {after: 'links[_key=="l2"]', items: [{...l2, _key: 'l1'}]}})), /key in use/)
  refused(tx(patch({insert: {after: 'links[_key=="l2"]', items: [{_type: 'x', _key: 'a"]b'}]}})))
  refused(tx(patch({insert: {after: 'links[0]', items: [{_type: 'x', _key: 'n1'}]}})))
  refused(tx(patch({insert: {after: 'links[_key=="l2"]', items: [{_type: {name: 'x'}, _key: 'n1'}]}})))
  // Not a transaction at all; more than one change; a giant one.
  for (const junk of [null, 7, 'mutate', [], {}, {mutations: 'x'}, {mutations: []}, {mutations: [null]}, {mutations: [[]]}, {mutations: move, dryRun: false}]) refused(junk)
  refused(tx(...move, patch({unset: ['links[0:1]']})), /more than one change/)
  refused(tx(patch({unset: ['links[1:2]']}), patch({unset: ['links[0:1]']})), /not an array move/)
  refused({mutations: [{createIfNotExists: {...copy, body: 'x'.repeat(MUTATE_MAX)}}, ...move]}, /too large/)
  const loop: Record<string, unknown> = {mutations: move}
  loop.transactionId = loop
  refused(loop)
})

const fields = [
  {name: 'title', type: 'string'},
  {name: 'links', type: 'arrayOf', of: {type: 'composite', initialValue: {title: 'Read more'}, fields: [{name: 'title', type: 'string'}]}},
  {name: 'categories', type: 'arrayOf', of: {type: 'reference', refType: 'category'}},
  {name: 'tags', type: 'arrayOf', of: {type: 'string'}},
  {name: 'locked', type: 'arrayOf', readOnly: true, of: {type: 'composite', fields: []}},
  {name: 'sometimes', type: 'arrayOf', readOnly: {field: 'stage', operator: 'eq', value: 'done'}, of: {type: 'composite', fields: []}},
  {name: 'orderRank', type: 'arrayOf', hidden: true, of: {type: 'composite', fields: []}},
  {name: 'body', type: 'richText', format: 'portableText'},
  {name: 'seo', type: 'composite', fields: [{name: 'keywords', type: 'arrayOf', of: {type: 'composite', fields: []}}]},
  {name: 'sections', type: 'arrayOf', of: [
    {name: 'banner', type: 'composite', fields: [{name: 'tiles', type: 'arrayOf', of: {type: 'image'}}]},
    {name: 'quote', type: 'composite', initialValue: {text: '…'}, fields: [{name: 'text', type: 'text'}]},
  ]},
] as unknown as Field[]
const schema = {fields} as Pick<Schema, 'fields'>
const doc = {sections: [{_key: 's1', _type: 'banner', tiles: [{_key: 't1'}]}, {_key: 's2', _type: 'quote'}]}

test('arrayField: only an array of keyed items the schema has, and the form would let be edited', () => {
  assert.equal(arrayField(schema, 'links', doc)?.name, 'links')
  assert.equal(arrayField(schema, 'categories', doc)?.name, 'categories')
  assert.equal(arrayField(schema, 'seo.keywords', doc)?.name, 'keywords')
  assert.equal(arrayField(schema, 'sections', doc)?.name, 'sections')
  assert.equal(arrayField(schema, 'sections[_key=="s1"].tiles', doc)?.name, 'tiles')
  // A quote has no tiles; an item the document lacks is no way in.
  assert.equal(arrayField(schema, 'sections[_key=="s2"].tiles', doc), null)
  assert.equal(arrayField(schema, 'sections[_key=="nope"].tiles', doc), null)
  // Not arrays of keyed items: a string, a list of strings, a Portable Text body.
  for (const path of ['title', 'tags', 'body', 'seo', 'unknown', 'links.title', '_id', 'links[_key=="l1"]']) assert.equal(arrayField(schema, path, doc), null, path)
  // Read-only (always, or on a condition) and hidden fields.
  for (const path of ['locked', 'sometimes', 'orderRank']) assert.equal(arrayField(schema, path, doc), null, path)
  assert.equal(arrayField(undefined, 'links', doc), null)
})

test('applyArrayOp: done on the studio\'s own items, by key; a key that is gone is stale, never guessed', () => {
  const links = [{_key: 'l1', title: 'One'}, {_key: 'l2', title: 'Two'}, {_key: 'l3', title: 'Three'}]
  const field = fields[1]!
  const keys = (op: ArrayOp, value: unknown = links, f = field) => {
    const out = applyArrayOp(value, op, f)
    return 'next' in out ? out.next.map((x) => x._key).join(' ') : out
  }
  assert.equal(keys({kind: 'move', key: 'l3', position: 'before', ref: 'l1'}), 'l3 l1 l2')
  assert.equal(keys({kind: 'move', key: 'l1', position: 'after', ref: 'l3'}), 'l2 l3 l1')
  assert.equal(keys({kind: 'move', key: 'l1', position: 'after', ref: 'l2'}), 'l2 l1 l3')
  // Already there (the form moved it first): nothing to write.
  assert.deepEqual(applyArrayOp(links, {kind: 'move', key: 'l1', position: 'before', ref: 'l2'}, field), {next: links, same: true})
  assert.equal(keys({kind: 'remove', key: 'l2'}), 'l1 l3')
  // The copy is the studio's item, not the page's.
  const copied = applyArrayOp(links, {kind: 'duplicate', key: 'l2', newKey: 'n1', position: 'after'}, field)
  assert.deepEqual('next' in copied && copied.next, [links[0], links[1], {_key: 'n1', title: 'Two'}, links[2]])
  // A new item is the form's "Add item": the member's starting values, the page's key.
  const added = applyArrayOp(links, {kind: 'insert', member: 'composite', newKey: 'n1', position: 'before', ref: 'l1'}, field)
  assert.deepEqual('next' in added && added.next[0], {title: 'Read more', _key: 'n1'})
  const ref = applyArrayOp([{_key: 'c1', _type: 'reference', _ref: 'category-news'}], {kind: 'insert', member: 'reference', newKey: 'n1', position: 'after', ref: 'c1'}, fields[2]!)
  assert.deepEqual('next' in ref && ref.next[1], {_key: 'n1', _type: 'reference'})
  const section = applyArrayOp(doc.sections, {kind: 'insert', member: 'quote', newKey: 'n1', position: 'after', ref: 's2'}, fields[9]!)
  assert.deepEqual('next' in section && section.next[2], {text: '…', _type: 'quote', _key: 'n1'})
  assert.ok('refused' in applyArrayOp(doc.sections, {kind: 'insert', member: 'video', newKey: 'n1', position: 'after', ref: 's2'}, fields[9]!))
  // Gone meanwhile: the item, or the one it went beside.
  for (const op of [
    {kind: 'move', key: 'gone', position: 'before', ref: 'l1'},
    {kind: 'move', key: 'l1', position: 'before', ref: 'gone'},
    {kind: 'remove', key: 'gone'},
    {kind: 'duplicate', key: 'gone', newKey: 'n1', position: 'after'},
    {kind: 'insert', member: 'composite', newKey: 'n1', position: 'after', ref: 'gone'},
    {kind: 'duplicate', key: 'l1', newKey: 'l2', position: 'after'},
  ] as ArrayOp[]) assert.equal((keys(op) as {stale?: boolean}).stale, true, JSON.stringify(op))
  // Done, as the saved array shows it: a move dropped by another editor's reorder is not.
  assert.equal(holds([{_key: 'l4'}, {_key: 'l1'}, {_key: 'l2'}], {kind: 'move', key: 'l4', position: 'before', ref: 'l1'}), true)
  assert.equal(holds([{_key: 'l2'}, {_key: 'l1'}, {_key: 'l3'}, {_key: 'l4'}], {kind: 'move', key: 'l4', position: 'before', ref: 'l1'}), false)
  assert.equal(holds([{_key: 'l1'}, {_key: 'l4'}], {kind: 'move', key: 'l4', position: 'after', ref: 'l1'}), true)
  assert.equal(holds([{_key: 'l1'}], {kind: 'remove', key: 'l4'}), true)
  assert.equal(holds([{_key: 'l1'}], {kind: 'remove', key: 'l1'}), false)
  assert.equal(holds([{_key: 'l1'}, {_key: 'n1'}], {kind: 'duplicate', key: 'l1', newKey: 'n1', position: 'after'}), true)
  assert.equal(holds(undefined, {kind: 'insert', member: '', newKey: 'n1', position: 'after', ref: 'l1'}), false)
  // Not an array of keyed items.
  assert.ok('refused' in applyArrayOp(undefined, {kind: 'remove', key: 'l1'}, field))
  assert.ok('refused' in applyArrayOp(['a', 'b'], {kind: 'remove', key: 'l1'}, field))
  assert.ok('refused' in applyArrayOp([{_key: 'l1'}, {title: 'no key'}], {kind: 'remove', key: 'l1'}, field))
})

test('a preview path that would resolve to another site is no path (task-ff4190a0473f2985)', () => {
  const origin = 'http://localhost:3537'
  assert.equal(framePath('http://localhost:3537/posts/a?x=1', origin), '/posts/a?x=1')
  // Same origin, but its path read again against the origin is evil.example.
  assert.equal(framePath('http://localhost:3537//evil.example/x', origin), null)
  assert.equal(framePath('http://localhost:3537/\\evil.example/x', origin), null)
  assert.equal(framePath('//evil.example/x', origin), null)
  assert.equal(ownPath('/posts/a'), true)
  assert.equal(ownPath('/'), true)
  for (const path of ['//evil.example', '/\\evil.example', '\\\\evil.example', 'posts/a', 'https://evil.example', '', undefined, 7]) assert.equal(ownPath(path), false, String(path))
})
