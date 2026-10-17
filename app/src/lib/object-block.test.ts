import assert from 'node:assert/strict'
import {test} from 'node:test'
import {objectBlockTitle, objectKinds} from './object-block.ts'

const yesNo = (v: boolean) => (v ? 'Yes' : 'No')
const callout = {name: 'callout', title: 'Callout', fields: [{name: 'tone', type: 'select'}, {name: 'text', type: 'text'}]}

test("an object block's title reads as the canvas's: a text field with text, else the first scalar, else the type", () => {
  assert.deepEqual(objectKinds({of: ['image', callout]}), [callout], 'plain types are not object kinds')
  assert.equal(objectBlockTitle(callout, {type: 'callout', tone: 'info', content: [{type: 'text', value: 'A custom block.'}]}, yesNo), 'info')
  assert.equal(objectBlockTitle(callout, {type: 'callout', tone: 'info', text: ' Mind the gap '}, yesNo), 'Mind the gap')
  assert.equal(objectBlockTitle({name: 'flag', fields: [{name: 'on', type: 'boolean'}]}, {on: false}, yesNo), 'No')
  assert.equal(objectBlockTitle(callout, {type: 'callout'}, yesNo), 'Callout')
})
