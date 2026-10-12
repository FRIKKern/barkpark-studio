// J37: Vision's Params, put into the query string before it reaches Barkpark.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {applyParams, parseParams} from './vision-params.ts'

test('params: JSON object in, values encoded into $names, a missing one named', () => {
  assert.deepEqual(parseParams(''), {params: {}})
  assert.deepEqual(parseParams('{"t": "a b"}'), {params: {t: 'a b'}})
  assert.ok('error' in parseParams('{oops'))
  assert.ok('error' in parseParams('[1]'))
  assert.deepEqual(applyParams('post?filter[title][contains]=$t&limit=$n', {t: 'a b', n: 3}), {query: 'post?filter[title][contains]=a%20b&limit=3'})
  assert.deepEqual(applyParams('post?filter[_id][in]=$ids', {ids: ['post-01', 'post-02']}), {query: 'post?filter[_id][in]=post-01%2Cpost-02'})
  assert.deepEqual(applyParams('post?filter[title][eq]=$x', {}), {error: 'Param $x referenced, but not provided'})
  assert.deepEqual(applyParams('post?limit=5', {unused: 1}), {query: 'post?limit=5'})
})
