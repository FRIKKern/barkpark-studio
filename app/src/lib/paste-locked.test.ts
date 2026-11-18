// task-be96d37504cf4ed3: at any depth, a hidden field is never written and a read-only one is
// never pasted over, by Paste document or by Paste field on the object or array around it.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {Field} from './data.ts'
import type {FieldConditions} from './conditions.ts'
import {keepLocked, type PasteContext} from './paste-locked.ts'

const seo = {name: 'seo', type: 'composite', fields: [{name: 'metaTitle', type: 'string'}, {name: 'metaDescription', type: 'text'}]} as unknown as Field
const links = {name: 'links', type: 'arrayOf', of: {type: 'composite', fields: [{name: 'title', type: 'string'}, {name: 'url', type: 'url'}]}} as unknown as Field
const user = {id: 'u1', name: 'A', email: 'a@example.com', roles: [{name: 'editor', title: 'Editor'}]}
const ctx = (rules: Record<string, FieldConditions>, doc: Record<string, unknown>): PasteContext => ({type: 'post', doc, user, rules})

test('Paste document: a hidden field inside an object keeps the target\'s value; the rest of the object pastes', () => {
  const doc = {seo: {metaTitle: 'A', metaDescription: 'HIDDEN A'}}
  const c = ctx({'post.seo.metaDescription': {hidden: () => true}}, doc)
  assert.deepEqual(keepLocked(seo, 'seo', {metaTitle: 'B', metaDescription: 'HIDDEN B'}, doc.seo, c), {metaTitle: 'B', metaDescription: 'HIDDEN A'})
  // The target has none: the pasted one is not written either.
  assert.deepEqual(keepLocked(seo, 'seo', {metaTitle: 'B', metaDescription: 'HIDDEN B'}, {metaTitle: 'A'}, c), {metaTitle: 'B'})
})

test('Paste document: a read-only field in an array item keeps its value by _key; an item only the source has comes in whole', () => {
  const doc = {links: [{_key: 'l1', title: 'Docs A', url: 'https://a.example'}]}
  const c = ctx({'post.links.title': {readOnly: () => true}}, doc)
  const pasted = [
    {_key: 'l1', title: 'Docs B', url: 'https://b.example'},
    {_key: 'n1', title: 'New', url: 'https://n.example'},
  ]
  assert.deepEqual(keepLocked(links, 'links', pasted, doc.links, c), [
    {_key: 'l1', title: 'Docs A', url: 'https://b.example'},
    {_key: 'n1', title: 'New', url: 'https://n.example'},
  ])
})

test('Paste field on an object keeps its hidden child, also when the copy has none or no object at all', () => {
  const doc = {seo: {metaTitle: 'A', metaDescription: 'HIDDEN A'}}
  const c = ctx({'post.seo.metaDescription': {hidden: () => true}}, doc)
  assert.deepEqual(keepLocked(seo, 'seo', {metaTitle: 'B'}, doc.seo, c), {metaTitle: 'B', metaDescription: 'HIDDEN A'})
  assert.deepEqual(keepLocked(seo, 'seo', undefined, doc.seo, c), {metaDescription: 'HIDDEN A'})
  // Nothing locked: the paste is what was copied.
  assert.deepEqual(keepLocked(seo, 'seo', {metaTitle: 'B'}, doc.seo, ctx({}, doc)), {metaTitle: 'B'})
})

test('a paste that would remove an item holding a read-only value leaves that item where it was', () => {
  const doc = {links: [{_key: 'l1', title: 'Docs A', url: 'https://a.example'}, {_key: 'l2', url: 'https://untitled.example'}, {_key: 'l3', title: 'Kept', url: 'https://k.example'}]}
  const c = ctx({'post.links.title': {readOnly: () => true}}, doc)
  // l1 and l3 hold a read-only title and stay; l2 holds none and goes, as pasted.
  assert.deepEqual(keepLocked(links, 'links', [{_key: 'n1', title: 'New', url: 'https://n.example'}], doc.links, c), [
    {_key: 'l1', title: 'Docs A', url: 'https://a.example'},
    {_key: 'n1', title: 'New', url: 'https://n.example'},
    {_key: 'l3', title: 'Kept', url: 'https://k.example'},
  ])
})
