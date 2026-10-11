import {test} from 'node:test'
import assert from 'node:assert/strict'
import {toCsv} from './vision-csv.ts'

test('Vision CSV: a row per document, dotted columns, lists as JSON, quoting', () => {
  const body = {result: {documents: [
    {_id: 'post-1', title: 'A, "quoted"', slug: {current: 'a'}, tags: ['x', 'y']},
    {_id: 'post-2', title: 'Two\nlines', rating: 4, empty: null},
  ]}}
  assert.equal(toCsv(body), [
    '_id,title,slug.current,tags,rating,empty',
    'post-1,"A, ""quoted""",a,"[""x"",""y""]",,',
    'post-2,"Two\nlines",,,4,',
  ].join('\n'))
  assert.equal(toCsv({result: {documents: []}}), null)
  assert.equal(toCsv({result: 3}), null)
  assert.equal(toCsv({result: {_id: 'a'}}), '_id\na')
})
