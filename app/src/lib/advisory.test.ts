// J13: Barkpark's advisory findings (#22406) join the studio's own checks.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {Schema} from './data.ts'
import {advisoryProblems, type Finding} from './findings.ts'
import type {Problem} from './validation.ts'

const post: Schema = {
  name: 'post',
  title: 'Post',
  fields: [
    {name: 'rating', title: 'Rating', type: 'number', group: 'meta', validation: {max: 5}},
    {name: 'tags', title: 'Tags', type: 'arrayOf', group: 'meta', validation: {max: 3, level: 'warning'}},
    {name: 'seo', title: 'SEO', type: 'composite', fields: [{name: 'metaTitle', title: 'Meta title', type: 'string', validation: {required: false}}]},
  ],
}
const f = (path: string, code: string, params = {}): Finding => ({path, code, params, message: 'English from Barkpark'})

test('a finding the studio already flags is left to it; the others join, at their field’s level', () => {
  const own: Problem[] = [{path: 'rating', title: 'Rating', message: 'Must be lower than or equal to 5', level: 'error', group: 'meta'}]
  const en = (s: string, vars?: Record<string, string | number>) => (vars ? s.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all)) : s)
  const extra = advisoryProblems([f('/rating', 'number_too_large', {max: 5}), f('/tags', 'list_too_long', {max: 3}), f('/seo/metaTitle', 'pattern_mismatch')], post, own, en)
  assert.deepEqual(extra, [
    {path: 'tags', title: 'Tags', message: 'Must have at most 3 items', level: 'warning', group: 'meta'},
    {path: 'seo.metaTitle', title: 'Meta title', message: 'Does not match the required format', level: 'error', parents: ['SEO'], group: undefined},
  ])
})
