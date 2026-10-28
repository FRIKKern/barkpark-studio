import {test} from 'node:test'
import assert from 'node:assert/strict'
import type {Field, Schema} from './data.ts'
import {isObjectMembers, isReferenceMembers, memberChoices, memberFor, memberName, memberPreview, membersOf, mergedReference, newMemberItem, referenceHeads} from './array-members.ts'

// A made-up page builder: an array whose `of` lists two named object types, as Barkpark
// serves it (each member expanded, with `namedType`).
const banner: Field = {name: 'banner', namedType: 'banner', title: 'Banner', type: 'composite', fields: [{name: 'headline', type: 'string'}]}
const gallery: Field = {name: 'gallery', namedType: 'gallery', type: 'composite', fields: [{name: 'caption', type: 'text'}], initialValue: {columns: 3}}
const blocks = {name: 'blocks', type: 'arrayOf', of: [banner, gallery] as unknown as Field}
const schemas = [
  {name: 'banner', title: 'Banner', listPreview: {}},
  {name: 'gallery', title: 'Photo gallery', listPreview: {title: 'caption', subtitle: 'columns'}},
] as Pick<Schema, 'name' | 'title' | 'listPreview'>[]

test('page builder: an array whose of lists two member types has both, as rows of objects', () => {
  assert.deepEqual(membersOf(blocks).map(memberName), ['banner', 'gallery'])
  assert.equal(isObjectMembers(membersOf(blocks)), true)
  // One member, as a list or not, is the old single-member array.
  assert.deepEqual(membersOf({of: [banner] as unknown as Field}), [banner])
  assert.deepEqual(membersOf({of: banner}), [banner])
  assert.equal(isObjectMembers([banner]), false)
  assert.deepEqual(membersOf({}), [])
  // Two kinds of references are another input's (task-3324220d080ea394).
  assert.equal(isObjectMembers([{name: 'a', type: 'reference'}, {name: 'b', type: 'reference'}]), false)
  assert.equal(isObjectMembers([{name: 'image', type: 'image'}, {name: 'productImage', type: 'composite'}]), true)
})

test('page builder: each item takes its member by _type', () => {
  const members = membersOf(blocks)
  assert.equal(memberFor(members, {_type: 'gallery', _key: 'k1'}), gallery)
  assert.equal(memberFor(members, {_type: 'banner', _key: 'k2'}), banner)
  assert.equal(memberFor(members, {_type: 'unknown', _key: 'k3'}), undefined)
  assert.equal(memberFor(members, {_key: 'k4'}), undefined)
  assert.equal(memberFor([banner], {_key: 'k5'}), banner)
})

test('page builder: Add item offers the members and writes _type and _key', () => {
  assert.deepEqual(memberChoices(membersOf(blocks), schemas), [
    {value: 'banner', title: 'Banner'},
    {value: 'gallery', title: 'Photo gallery'},
  ])
  assert.deepEqual(newMemberItem(gallery, 'abc123'), {columns: 3, _type: 'gallery', _key: 'abc123'})
  assert.deepEqual(newMemberItem(banner, 'def456'), {_type: 'banner', _key: 'def456'})
  assert.deepEqual(newMemberItem({name: 'image', type: 'image'}, 'img1'), {_type: 'image', _key: 'img1'})
})

test('page builder: an item reads its member preview, else its named type list preview', () => {
  assert.equal(memberPreview(banner, schemas), undefined)
  assert.deepEqual(memberPreview(gallery, schemas), {title: 'caption', subtitle: 'columns'})
  assert.deepEqual(memberPreview({...banner, preview: {title: 'headline'}}, schemas), {title: 'headline'})
})

test('an array of references to several types: one reference member to all of them', () => {
  const toAuthor: Field = {name: 'authorRef', type: 'reference', to: [{type: 'author'}], refType: 'author'}
  const toPost: Field = {type: 'reference', name: 'postRef', to: [{type: 'post'}, {type: 'note'}]}
  const members = membersOf({of: [toAuthor, toPost] as unknown as Field})
  assert.equal(isReferenceMembers(members), true)
  assert.equal(isObjectMembers(members), false)
  assert.equal(isReferenceMembers([toAuthor]), false)
  assert.equal(isReferenceMembers([toAuthor, banner]), false)
  const one = mergedReference(members)
  assert.equal(one.type, 'reference')
  assert.deepEqual(one.to, [{type: 'author'}, {type: 'post'}, {type: 'note'}])
  assert.equal(one.refType, 'author')
})

test('an item preview reads through a reference field only, not through an object or a list', () => {
  const section: Field = {
    name: 'hero',
    type: 'composite',
    fields: [
      {name: 'heading', type: 'string'},
      {name: 'styling', type: 'composite', fields: [{name: 'theme', type: 'select'}]},
      {name: 'cta', type: 'composite', fields: [{name: 'text', type: 'string'}]},
      {name: 'tiles', type: 'arrayOf'},
      {name: 'linkedDocument', type: 'reference', to: [{type: 'post'}]},
    ],
  }
  assert.deepEqual(referenceHeads(section, ['styling.theme', 'cta.text', 'tiles.0.image', 'heading']), [])
  assert.deepEqual(referenceHeads(section, ['linkedDocument.title', 'styling.theme', 'linkedDocument']), ['linkedDocument'])
})
