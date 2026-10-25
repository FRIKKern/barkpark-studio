import assert from 'node:assert/strict'
import {test} from 'node:test'
import {orUnset, withField} from './with-field.ts'

test('a cleared field in an object held whole leaves no key; a set one is set', () => {
  const item = {_key: 'l1', _type: 'externalLink', title: 'Docs', url: 'https://example.com'}
  assert.deepEqual(withField(item, 'url', ''), {_key: 'l1', _type: 'externalLink', title: 'Docs'})
  assert.deepEqual(withField(item, 'url', undefined), {_key: 'l1', _type: 'externalLink', title: 'Docs'})
  assert.deepEqual(withField(withField(item, 'url', ''), 'url', 'https://x.io').url, 'https://x.io')
  assert.equal((withField(item, 'count', 0) as Record<string, unknown>).count, 0) // 0 and false are values
  assert.equal(orUnset({_type: 'address'}), undefined)
  assert.deepEqual(orUnset({_type: 'address', zip: '0154'}), {_type: 'address', zip: '0154'})
})
