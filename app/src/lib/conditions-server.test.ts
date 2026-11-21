// The studio's condition rules give Barkpark's answers (review of PR #1336): the cases and
// Barkpark's own answers are in fixtures/field-visibility-cases.json, made by running Barkpark's
// field_visibility.ex and cross_validator.ex (scripts/field-visibility-cases.exs).
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import type {Doc, Schema} from './data.ts'
import {crossProblems} from './cross-rules.ts'

type Case = {name: string; rule: unknown; doc: Record<string, unknown>; server: 'ok' | 'violated' | 'skip'}
const {cases} = JSON.parse(readFileSync(new URL('../../../fixtures/field-visibility-cases.json', import.meta.url), 'utf8')) as {cases: Case[]}
const fields = ['a', 'n', 'tags', 'links', 'obj', 'ref', 'd'].map((name) => ({name, type: 'string'}))

// JSON gives JavaScript one number type: 1.0 arrives as 1, so `in [1]` cannot tell them apart
// as Elixir's strict `in` does. The only case the studio cannot answer as Barkpark does.
const ONE_NUMBER_TYPE = new Set(['in [1], n=1.0'])

test('the studio gives Barkpark\'s answer for every condition case (fixtures/field-visibility-cases.json)', () => {
  assert.equal(cases.length, 95)
  const wrong = cases.flatMap((c) => {
    const schema = {name: 't', title: 'T', fields, crossValidations: [{name: 'r', rule: c.rule, fields: ['a']}]} as unknown as Schema
    const studio = crossProblems({_id: 'x', _type: 't', ...c.doc} as unknown as Doc, schema).length ? 'violated' : 'ok'
    const want = c.server === 'skip' ? 'ok' : c.server // a rule Barkpark cannot evaluate is no finding
    return studio === want || ONE_NUMBER_TYPE.has(c.name) ? [] : [`${c.name}: studio ${studio}, Barkpark ${c.server}`]
  })
  assert.deepEqual(wrong, [])
})
