import {test} from 'node:test'
import assert from 'node:assert/strict'
import {resolveTemplate} from './template-resolve.ts'
import type {Template} from './plugins.ts'

// task-464876895f8ab042: a new document's URL (and an intent link) names its template and
// parameters, and a URL is anyone's input. Only a template for that type is used; its
// parameters reach only its own function, by the names it declares; nothing sets _id, _type
// or another system field; anything else falls back (no template: the pane says not found).
const templates: Template[] = [
  {id: 'post-by-alan', title: 'Post by Alan Turing', schemaType: 'post', value: {author: 'author-alan', _type: 'author', _id: 'x'}},
  {id: 'post-by-author', title: 'Post by author', schemaType: 'post', parameters: ['authorId'], value: ({authorId}) => ({author: authorId, _rev: 'r'})},
  {id: 'throws', title: 'Throws', schemaType: 'post', parameters: ['n'], value: () => { throw new Error('bad') }},
]
const own = (type: string) => (type === 'post' ? {title: 'Post', value: {stage: 'draft', _createdAt: 'then'}} : type === 'category' ? {title: 'Category', value: {}} : undefined)
const resolve = (type: string, id: string, params?: Record<string, unknown>) => resolveTemplate(templates, own, type, id, params as Record<string, string>)

test('a template for its own type, its parameters by the names it declares', () => {
  assert.deepEqual(resolve('post', 'post-by-author', {authorId: 'author-ada'}), {id: 'post-by-author', title: 'Post by author', type: 'post', value: {author: 'author-ada'}, params: {authorId: 'author-ada'}})
  assert.deepEqual(resolve('post', 'post-by-alan')?.value, {author: 'author-alan'})
  assert.deepEqual(resolve('post', 'post')?.value, {stage: 'draft'})
})

test('an unknown template, or one for another type, gives none', () => {
  assert.equal(resolve('post', 'nope'), undefined)
  assert.equal(resolve('category', 'post-by-author', {authorId: 'author-ada'}), undefined)
  assert.equal(resolve('category', 'post-by-alan'), undefined)
  assert.equal(resolve('nosuchtype', 'nosuchtype'), undefined)
})

test('parameters: only declared names, only strings; a missing one or a throwing template gives none', () => {
  assert.deepEqual(resolve('post', 'post-by-author', {authorId: 'a', _id: 'evil', _type: 'author', extra: 'x'})?.params, {authorId: 'a'})
  assert.equal(resolve('post', 'post-by-author', {}), undefined)
  assert.equal(resolve('post', 'post-by-author', {authorId: {_ref: 'x'}}), undefined)
  assert.equal(resolve('post', 'throws', {n: '1'}), undefined)
})

test('no system field from a template or its parameters', () => {
  for (const c of [resolve('post', 'post-by-alan'), resolve('post', 'post-by-author', {authorId: 'a'}), resolve('post', 'post')]) assert.ok(c && !Object.keys(c.value).some((k) => k.startsWith('_')), JSON.stringify(c))
})
