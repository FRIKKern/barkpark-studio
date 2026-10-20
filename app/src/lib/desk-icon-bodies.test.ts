import {test} from 'node:test'
import assert from 'node:assert/strict'
import {withIconBodies} from './desk-icon-bodies.ts'

test('a desk tree gets each named icon its body, through nested lists; an unknown name gets none to load', () => {
  const tree = {id: 'root', items: [{id: 'a', icon: 'folder'}, {id: 'b', items: [{id: 'c', icon: 'file'}, {id: 'd'}]}]}
  const out = withIconBodies(tree, {folder: '<path d="F"/>'})
  assert.deepEqual(out, {id: 'root', items: [{id: 'a', icon: 'folder', iconSvg: '<path d="F"/>'}, {id: 'b', items: [{id: 'c', icon: 'file', iconSvg: ''}, {id: 'd'}]}]})
  assert.deepEqual(withIconBodies([{icon: 'folder'}], {folder: 'x'}), [{icon: 'folder', iconSvg: 'x'}])
})
