import {test} from 'node:test'
import assert from 'node:assert/strict'
import {withIconBodies, withOptionIconBodies} from './desk-icon-bodies.ts'

test('a desk tree gets each named icon its body, through nested lists; an unknown name gets none to load', () => {
  const tree = {id: 'root', items: [{id: 'a', icon: 'folder'}, {id: 'b', items: [{id: 'c', icon: 'file'}, {id: 'd'}]}]}
  const out = withIconBodies(tree, {folder: '<path d="F"/>'})
  assert.deepEqual(out, {id: 'root', items: [{id: 'a', icon: 'folder', iconSvg: '<path d="F"/>'}, {id: 'b', items: [{id: 'c', icon: 'file', iconSvg: ''}, {id: 'd'}]}]})
  assert.deepEqual(withIconBodies([{icon: 'folder'}], {folder: 'x'}), [{icon: 'folder', iconSvg: 'x'}])
})

test('an iconSvg the desk carries is never passed on; an inherited key is no icon name', () => {
  assert.deepEqual(withIconBodies({id: 'a', iconSvg: '<img src=x onerror=alert(1)>'}, {folder: 'x'}), {id: 'a'})
  assert.deepEqual(withIconBodies({id: 'b', icon: 'folder', iconSvg: '<script>'}, {folder: 'x'}), {id: 'b', icon: 'folder', iconSvg: 'x'})
  assert.deepEqual(withIconBodies({id: 'c', icon: 'constructor'}, {folder: 'x'}), {id: 'c', icon: 'constructor', iconSvg: ''})
})

test("a select option's icon gets its body (an insert menu's types); nothing else does, and a carried one is dropped", () => {
  const fields = [{name: 'kind', type: 'select', icon: 'folder', initialValue: {value: 'v', icon: 'folder'}, options: [{value: 'hero', title: 'Hero', icon: 'folder'}, {value: 'faq', icon: 'nope'}, {value: 'x', iconSvg: '<img onerror=1>'}]}]
  assert.deepEqual(withOptionIconBodies(fields, {folder: 'F'}), [{name: 'kind', type: 'select', icon: 'folder', initialValue: {value: 'v', icon: 'folder'}, options: [{value: 'hero', title: 'Hero', icon: 'folder', iconSvg: 'F'}, {value: 'faq', icon: 'nope', iconSvg: ''}, {value: 'x'}]}])
})
