import {test} from 'node:test'
import assert from 'node:assert/strict'
import type {Field, Schema} from './data.ts'
import {isObjectMembers, memberChoices, memberFor, memberName, memberPreview, membersOf, newMemberItem} from './array-members.ts'

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
