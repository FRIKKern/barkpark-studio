import {test} from 'node:test'
import assert from 'node:assert/strict'
import type {Field, Schema} from './data.ts'
import {iconMarkup, previewSchema, unionTypes} from './presentation-schema.ts'

// The post of fixtures/barkpark-schema, cut to one field of each kind the overlays read.
const banner = {name: 'banner', namedType: 'banner', title: 'Banner', type: 'composite', fields: [{name: 'headline', title: 'Headline', type: 'string'}]}
const quote = {name: 'quote', namedType: 'quote', type: 'composite', fields: [{name: 'text', type: 'text'}]}
const post = {
  name: 'post',
  title: 'Post',
  fields: [
    {name: 'title', title: 'Title', type: 'string', validation: {required: true}},
    {name: 'author', title: 'Author', type: 'reference', refType: 'author'},
    {name: 'categories', title: 'Categories', type: 'arrayOf', of: {type: 'reference', refType: 'category'}},
    {name: 'links', title: 'Links', type: 'arrayOf', of: {type: 'composite', fields: [{name: 'title', title: 'Title', type: 'string'}, {name: 'url', type: 'url'}]}},
    {name: 'sections', title: 'Sections', type: 'arrayOf', of: [banner, quote]},
    {name: 'mainImage', title: 'Main image', type: 'image', fields: [{name: 'alt', title: 'Alternative text', type: 'string'}]},
    {name: 'seo', title: 'SEO', type: 'composite', fields: [{name: 'metaTitle', title: 'Meta title', type: 'string'}]},
    {name: 'stage', type: 'select', options: {list: ['idea', {value: 'done', title: 'Done'}]}},
    {name: 'rating', type: 'number'},
    {name: 'body', type: 'richText', editor: 'blocks'},
    {name: 'where', type: 'geopoint'},
  ],
} as unknown as Schema
const section = {name: 'banner', title: 'Banner', kind: 'object', fields: banner.fields} as unknown as Schema

type Node = {type: string; name?: string; title?: string; optional?: boolean; value?: Node; fields?: Record<string, Node>; of?: Node | Node[]; rest?: Node; dereferencesTo?: string; icon?: string}
const fieldsOf = (schemas: Schema[], icons = {}) => (previewSchema(schemas, icons)[0] as Node).fields!

test('previewSchema: a document type as @sanity/visual-editing reads it', () => {
  const [doc, ...more] = previewSchema([post, section], {post: '<path d="M1 1"/>'}) as Node[]
  // Object types are served expanded where they are used: no entry of their own.
  assert.equal(more.length, 0)
  assert.equal(doc!.type, 'document')
  assert.equal(doc!.name, 'post')
  assert.equal(doc!.title, 'Post')
  assert.equal(doc!.icon, iconMarkup('<path d="M1 1"/>'))
  assert.match(doc!.icon!, /^<svg [^>]*viewBox="0 0 25 25"/)
  const f = doc!.fields!
  assert.deepEqual(f._type, {type: 'objectField', name: '_type', value: {type: 'string', value: 'post'}})
  assert.deepEqual(f.title, {type: 'objectField', name: 'title', value: {type: 'string'}, title: 'Title', optional: false})
  assert.equal(f.rating!.value!.type, 'number')
  assert.equal(f.rating!.optional, true)
  // A type without an icon carries none: the page draws Sanity's document icon.
  assert.equal('icon' in (previewSchema([post])[0] as Node), false)
})

test('previewSchema: references, objects and images', () => {
  const f = fieldsOf([post])
  assert.equal(f.author!.value!.type, 'object')
  assert.equal(f.author!.value!.dereferencesTo, 'author')
  assert.deepEqual(Object.keys(f.author!.value!.fields!), ['_ref', '_type', '_weak'])
  assert.deepEqual(f.seo!.value, {type: 'object', fields: {metaTitle: {type: 'objectField', name: 'metaTitle', value: {type: 'string'}, title: 'Meta title', optional: true}}})
  assert.equal(f.mainImage!.value!.fields!._type!.value!.value, 'image')
  assert.equal(f.mainImage!.value!.fields!.alt!.title, 'Alternative text')
  assert.deepEqual(f.stage!.value, {type: 'union', of: [{type: 'string', value: 'idea'}, {type: 'string', value: 'done'}]})
  // Barkpark's block document, as the page's paths walk it: body.blocks[1].content[0].value.
  assert.equal(((f.body!.value!.fields!.blocks!.value!.of as Node).value!.fields!.content!.value!.of as Node).value!.fields!.value!.value!.type, 'string')
  assert.deepEqual(f.where!.value, {type: 'unknown'})
})

test('previewSchema: an array is its item (the menu and the drag handle are an arrayItem\'s), several members a union', () => {
  const f = fieldsOf([post])
  // An array of references: each item a reference with its key.
  const categories = f.categories!.value!
  assert.equal(categories.type, 'array')
  const category = categories.of as Node
  assert.equal(category.type, 'arrayItem')
  assert.equal(category.name, 'reference')
  assert.equal(category.title, 'Categories')
  assert.equal(category.value!.dereferencesTo, 'category')
  assert.deepEqual(Object.keys(category.value!.rest!.fields!), ['_key'])
  // An array of objects: the item's own fields, `_key` beside them.
  const link = f.links!.value!.of as Node
  assert.equal(link.type, 'arrayItem')
  assert.equal(link.title, 'Links')
  assert.equal(link.value!.fields!.title!.title, 'Title')
  assert.deepEqual(Object.keys(link.value!.rest!.fields!), ['_key'])
  // Named members: a union, each option by the `_type` its items carry.
  const sections = f.sections!.value!
  assert.equal(sections.type, 'union')
  assert.deepEqual((sections.of as Node[]).map((o) => [o.type, o.name, o.title]), [['unionOption', 'banner', 'Banner'], ['unionOption', 'quote', undefined]])
  assert.equal((sections.of as Node[])[0]!.value!.fields!.headline!.title, 'Headline')
  assert.deepEqual(previewSchema([{name: 'empty', title: 'Empty', fields: [{name: 'list', type: 'arrayOf'} as Field]}])[0]!.fields, {...fieldsOf([{name: 'empty', title: 'Empty', fields: []}]), _type: {type: 'objectField', name: '_type', value: {type: 'string', value: 'empty'}}, list: {type: 'objectField', name: 'list', value: {type: 'null'}, optional: true}})
})

test('unionTypes: each keyed item\'s member, keyed as the page asked; nothing for a document it may not ask about', () => {
  const doc = {_type: 'post', sections: [{_key: 'a', _type: 'banner'}, {_key: 'b', _type: 'quote'}, {_key: 'c', _type: 'other'}], links: [{_key: 'l1', title: 'x'}]}
  const held = (id: string) => (id === 'post-01' ? doc : undefined)
  const asked = [
    {id: 'drafts.post-01', path: 'sections[_key=="a"]'},
    {id: 'drafts.post-01', path: 'sections[_key=="b"]'},
    {id: 'drafts.post-01', path: 'sections[_key=="c"]'},
    {id: 'drafts.post-01', path: 'links[_key=="l1"]'},
    {id: 'drafts.post-01', path: 'title'},
    {id: 'drafts.post-01', path: '__proto__[_key=="a"]'},
    {id: 'post-02', path: 'sections[_key=="a"]'},
    {id: 7, path: 'sections'},
    null,
  ]
  const types = unionTypes(asked, held, [post])
  assert.deepEqual([...types.keys()], ['drafts.post-01'])
  assert.deepEqual([...types.get('drafts.post-01')!], [['sections[_key=="a"]', 'banner'], ['sections[_key=="b"]', 'quote'], ['links[_key=="l1"]', 'composite']])
  assert.equal(unionTypes('nope', held, [post]).size, 0)
})
