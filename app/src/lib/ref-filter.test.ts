import assert from 'node:assert/strict'
import {test} from 'node:test'
import {groqKeepPath, isGroqFilter, referencingPath, refFilterOf, refFilterParams} from './ref-filter.ts'

test("a reference filter reads in Sanity's GROQ form and in Barkpark's query terms", () => {
  const groq = refFilterOf({filter: ' name != $skip ', filterParams: {skip: 'Alan Turing'}})
  assert.deepEqual(groq, {groq: 'name != $skip', params: {skip: 'Alan Turing'}})
  assert.ok(isGroqFilter(groq))
  assert.equal(refFilterParams(groq), '', 'a GROQ filter adds no query terms')
  assert.deepEqual(refFilterOf({filter: 'isSeries == true'}), {groq: 'isSeries == true', params: {}})
  const terms = refFilterOf({filter: {name: {neq: 'Alan Turing'}}})
  assert.equal(refFilterParams(terms), '&filter[name][neq]=Alan%20Turing')
  assert.equal(refFilterOf({filter: '  '}), undefined)
  assert.equal(refFilterOf(undefined), undefined)
  assert.equal(refFilterOf([{title: 'a', value: 'a'}]), undefined, "a select's list is not a filter")
})

test('the GROQ filter runs over the candidates with its params, as Barkpark’s picker asks', () => {
  const url = new URL(groqKeepPath('ci-2', {groq: 'name != $skip', params: {skip: 'Alan Turing'}}, ['author-alan', 'drafts.author-x']), 'http://x')
  assert.equal(url.pathname, '/v2025-02-19/data/query/ci-2')
  assert.equal(url.searchParams.get('query'), '*[_id in $bpCandidateIds && (name != $skip)]._id')
  assert.equal(url.searchParams.get('$skip'), '"Alan Turing"')
  assert.equal(url.searchParams.get('$bpCandidateIds'), '["author-alan","drafts.author-x"]')
  assert.equal(url.searchParams.get('perspective'), 'raw')
})

test("global search asks for every doc that references a matching target, in any field (Sanity's reference boost)", () => {
  // Sanity (e2e-local, 'Lovelace', 2026-10-26): every doc that references author-ada is a hit
  // with score 5, also through a field the type's preview does not show.
  const url = new URL(referencingPath('e2e-local', ['post', 'article'], ['author-ada']), 'http://x')
  assert.equal(url.pathname, '/v2025-02-19/data/query/e2e-local')
  assert.equal(url.searchParams.get('query'), '*[_type in $types && references($ids)]{_id, _type}')
  assert.equal(url.searchParams.get('$types'), '["post","article"]')
  assert.equal(url.searchParams.get('$ids'), '["author-ada"]')
  assert.equal(url.searchParams.get('perspective'), 'raw')
})
