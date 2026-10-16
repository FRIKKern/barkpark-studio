import {test} from 'node:test'
import assert from 'node:assert/strict'
import {API_VERSIONS, DEFAULT_API_VERSION, groqPath, groqTypes, isQueryString} from './vision-groq.ts'

test("GROQ as Sanity's Vision sends it; Barkpark's query string still told apart", () => {
  assert.equal(isQueryString('post?filter[title][contains]=x&limit=5'), true)
  assert.equal(isQueryString('post'), true)
  assert.equal(isQueryString('*[_type == "post"][0...3]{title}'), false)
  assert.equal(isQueryString('count(*[_type == "post"])'), false)
  assert.equal(DEFAULT_API_VERSION, API_VERSIONS.at(-1))
  const path = groqPath('e2e-local', 'v2025-02-19', ' *[_type == $t][0...3] ', {t: 'post', n: 3}, 'drafts')
  assert.equal(path.split('?')[0], '/v2025-02-19/data/query/e2e-local')
  const qs = new URLSearchParams(path.split('?')[1])
  assert.deepEqual([qs.get('query'), qs.get('$t'), qs.get('$n'), qs.get('perspective')], ['*[_type == $t][0...3]', '"post"', '3', 'drafts'])
  assert.ok(groqPath('e2e-local', 'v99', 'count(*)', {}, 'raw').startsWith(`/${DEFAULT_API_VERSION}/`))
  assert.deepEqual(groqTypes('*[_type == "post" || _type in ["author", \'category\']]'), ['post', 'author', 'category'])
  assert.deepEqual(groqTypes('*[defined(title)]'), [])
})
