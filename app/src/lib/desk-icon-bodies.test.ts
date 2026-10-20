import {test} from 'node:test'
import assert from 'node:assert/strict'
import {withIconBodies} from './desk-icon-bodies.ts'

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
