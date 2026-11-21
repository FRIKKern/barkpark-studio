// A cross rule's problem says what Barkpark's finding says, for any title (task-e4af1e37066bfb66):
// the cases and Barkpark's own finding messages are in fixtures/cross-title-cases.json, made by
// running Barkpark's cross_validator.ex (scripts/field-visibility-cases.exs). A per-language map
// title crashed the form ("Objects are not valid as a React child"), and "" was the name here
// but "" on Barkpark, until both read it as absent (barkpark#28089).
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import type {Doc, Field, Schema} from './data.ts'
import {crossProblems} from './cross-rules.ts'

type Case = {name: string; rule: unknown; doc: Record<string, unknown>; server: string[]}
const {cases} = JSON.parse(readFileSync(new URL('../../../fixtures/cross-title-cases.json', import.meta.url), 'utf8')) as {cases: Case[]}
const fields = [
  {name: 'meny', title: 'Meny', type: 'arrayOf', of: {name: 'item', type: 'composite', fields: [{name: 'side', title: 'Side', type: 'string'}]}},
  {name: 'innhold', title: 'Innhold', type: 'string'},
  {name: 'tittel', title: 'Tittel', type: 'string'},
  {name: 'innstillinger', title: 'Innstillinger', type: 'string'},
] as Field[]

test("the studio's problem says what Barkpark's finding says, for any title (fixtures/cross-title-cases.json)", () => {
  assert.equal(cases.length, 10)
  const wrong = cases.flatMap((c) => {
    const schema = {name: 't', title: 'T', fields, crossValidations: [c.rule]} as unknown as Schema
    const studio = crossProblems({_id: 'x', _type: 't', ...c.doc} as unknown as Doc, schema).map((p) => p.message)
    return JSON.stringify(studio) === JSON.stringify(c.server) ? [] : [`${c.name}: studio ${JSON.stringify(studio.slice(-2))}, Barkpark ${JSON.stringify(c.server.slice(-2))}`]
  })
  assert.deepEqual(wrong, [])
})
