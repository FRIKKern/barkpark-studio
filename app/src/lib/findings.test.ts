// Barkpark's coded validation findings (barkpark#22375) in the studio's words.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import barkpark from '../i18n/nb/barkpark.ts'
import fields from '../i18n/nb/fields.ts'
import {findingsOf, findingsReason, findingSentence, type Finding} from './findings.ts'

const en = (s: string, vars?: Record<string, string | number>) => (vars ? s.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all)) : s)
// The two chunks these strings live in, merged as i18n/nb.ts does (barkpark's last).
const nb: Record<string, string> = {...fields, ...barkpark}
const no = (s: string, vars?: Record<string, string | number>) => en(nb[s] ?? s, vars)
const f = (path: string, code: string, params: Finding['params'] = {}, message = 'English from Barkpark'): Finding => ({path, code, params, message})

test('each code in the studio’s words, in English and Norwegian; an unknown code keeps Barkpark’s English', () => {
  assert.equal(findingSentence(f('rating', 'number_too_large', {max: 5}), en), 'Must be lower than or equal to 5')
  assert.equal(findingSentence(f('rating', 'number_too_large', {max: 5}), no), 'Må være mindre enn eller lik 5')
  assert.equal(findingSentence(f('stage', 'not_in_list', {allowed: ['idea', 'done']}), no), 'Må være en av idea, done')
  assert.equal(findingSentence(f('x', 'something_new'), no), 'English from Barkpark')
  assert.equal(findingSentence(f('x', 'custom', {}, 'Written by the schema author'), no), 'Written by the schema author')
})

test('a refusal names each field by its title', () => {
  const titles: Record<string, string> = {title: 'Title', 'seo/metaDescription': 'SEO › Meta description'}
  const reason = findingsReason([f('title', 'required'), f('seo/metaDescription', 'string_too_short', {min: 50})], (p) => titles[p], no)
  assert.equal(reason, 'Title: Påkrevd. SEO › Meta description: Må være minst 50 tegn lang.')
})

test('only a 422 validation_failed with findings is read as one', () => {
  const body = {error: {code: 'validation_failed', message: 'document failed validation', findings: [f('title', 'required')]}}
  assert.deepEqual(findingsOf(`mutate 422: ${JSON.stringify(body)}`), body.error.findings)
  assert.equal(findingsOf(`mutate 422: {"error":{"code":"validation_failed","details":{"doc_id":["has already been taken"]}}}`), undefined)
  assert.equal(findingsOf(`mutate 403: ${JSON.stringify(body)}`), undefined)
})

test('a save’s advisory warnings carry the findings (#22406)', async () => {
  const {advisoryFindings, formPath} = await import('./findings.ts')
  const body = {warnings: [{code: 'patch.forked_published', message: 'x'}, {code: 'schema_validation', message: 'tags — Must have at most 3 items', findings: [f('tags', 'list_too_long', {max: 3})]}]}
  assert.deepEqual(advisoryFindings(body), [f('tags', 'list_too_long', {max: 3})])
  assert.deepEqual(advisoryFindings({}), [])
  assert.equal(formPath('/seo/metaDescription'), 'seo.metaDescription')
  assert.equal(formPath('/rating'), 'rating')
})
